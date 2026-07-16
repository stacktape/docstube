import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { serve } from '@hono/node-server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ControlPlaneInjection } from './trpc-router.ts';
import { controlPlaneRouter } from './trpc-router.ts';

// Session-guarded localhost control plane (PRODUCT §3.9): binds 127.0.0.1 only, and every /api
// request must present the crypto-random session token minted at startup. The tokened URL is the
// only capability handed to the browser — other local processes cannot drive the control plane.

const SESSION_HEADER = 'x-docstube-session';

const tokensMatch = (provided: string, expected: string): boolean => {
  // Hash both sides so timingSafeEqual gets equal-length buffers regardless of input length.
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
};

// In dev the UI is served by Vite on another loopback port, so /api needs CORS — but only ever
// for loopback origins.
const isLoopbackOrigin = (origin: string): boolean => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);

const staticContentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const fileResponse = (body: Uint8Array, path: string): Response =>
  new Response(new Uint8Array(body), {
    headers: { 'content-type': staticContentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream' }
  });

export type LocalAppOptions = {
  repoRoot: string;
  sessionToken: string;
  // When provided, the built UI is static-served from this directory (SPA fallback to index.html).
  uiDistDir?: string;
  // Agent/pipeline capabilities injected by the host (the CLI wizard command): task runner,
  // codemap provider, run launcher, read-tool descriptors. Absent fields make the corresponding
  // mutations fail with a clean "agent runner not configured" error — the session guard and every
  // read procedure keep working regardless.
  controlPlane?: ControlPlaneInjection;
};

export const createLocalApp = (options: LocalAppOptions): Hono => {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (isLoopbackOrigin(origin) ? origin : ''),
      allowHeaders: ['content-type', SESSION_HEADER]
    })
  );

  app.use('/api/*', async (c, next) => {
    const provided = c.req.header(SESSION_HEADER) ?? c.req.query('session');
    if (provided === undefined || provided.length === 0 || !tokensMatch(provided, options.sessionToken)) {
      return c.json({ error: 'missing or invalid session token' }, 401);
    }
    await next();
    return undefined;
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: controlPlaneRouter,
      createContext: () => ({ repoRoot: options.repoRoot, ...options.controlPlane })
    })
  );

  const uiDistDir = options.uiDistDir;
  if (uiDistDir !== undefined) {
    const distRoot = resolve(uiDistDir);
    app.get('*', async (c) => {
      const pathname = decodeURIComponent(new URL(c.req.url).pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const target = normalize(resolve(distRoot, relative));
      if (target !== distRoot && !target.startsWith(distRoot + sep)) {
        return c.notFound();
      }
      try {
        return fileResponse(await readFile(target), target);
      } catch {
        // SPA fallback: unknown routes render the app shell.
        try {
          return fileResponse(await readFile(resolve(distRoot, 'index.html')), 'index.html');
        } catch {
          return c.notFound();
        }
      }
    });
  }

  return app;
};

export type LocalServerOptions = {
  repoRoot: string;
  // 0 (default) binds a random free port.
  port?: number;
  uiDistDir?: string;
  // When the CLI dev loop runs the UI through Vite (DOCSTUBE_UI_DEV_SERVER_URL), the browser URL
  // points at Vite and carries the API base as a query param; the control plane serves /api only.
  uiDevServerUrl?: string;
  // Override for tests; production always mints a fresh random token.
  sessionToken?: string;
  controlPlane?: ControlPlaneInjection;
};

export type LocalServer = {
  port: number;
  sessionToken: string;
  // API origin, e.g. http://127.0.0.1:52341 — no token.
  apiBaseUrl: string;
  // The tokened URL to open in the browser.
  url: string;
  close: () => Promise<void>;
};

export const startLocalServer = async (options: LocalServerOptions): Promise<LocalServer> => {
  const sessionToken = options.sessionToken ?? randomBytes(24).toString('base64url');
  const app = createLocalApp({
    repoRoot: options.repoRoot,
    sessionToken,
    ...(options.uiDistDir !== undefined ? { uiDistDir: options.uiDistDir } : {}),
    ...(options.controlPlane !== undefined ? { controlPlane: options.controlPlane } : {})
  });

  const { server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>(
    (resolvePromise, rejectPromise) => {
      const instance = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port ?? 0 }, (info) => {
        resolvePromise({ server: instance, port: info.port });
      });
      instance.once('error', rejectPromise);
    }
  );

  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const url =
    options.uiDevServerUrl !== undefined
      ? `${options.uiDevServerUrl.replace(/\/+$/, '')}/?session=${sessionToken}&api=${encodeURIComponent(apiBaseUrl)}`
      : `${apiBaseUrl}/?session=${sessionToken}`;

  return {
    port,
    sessionToken,
    apiBaseUrl,
    url,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      })
  };
};
