import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { platform } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { appRouter } from './trpc-router.ts';
import { createLocalBackend } from './local-backend.ts';
import { openDocstubeDatabase } from './db-migrations.ts';
import type { StateBackend } from './state-backend.ts';

export type OpenBrowser = (url: string) => Promise<void> | void;

export type LocalControlPlaneAppOptions = {
  backend: StateBackend;
  sessionToken?: string;
  uiDevServerUrl?: string;
  uiDistDir?: string;
};

export type LocalControlPlaneApp = {
  app: Hono;
  sessionToken: string;
};

export type StartLocalControlPlaneOptions = LocalControlPlaneAppOptions & {
  host?: string;
  openBrowser?: OpenBrowser;
  port?: number;
};

export type StartedLocalControlPlane = {
  close: () => Promise<void>;
  host: string;
  port: number;
  sessionToken: string;
  url: string;
};

export type GenerateStartupOptions = Omit<StartLocalControlPlaneOptions, 'backend' | 'uiDistDir'> & {
  backend?: StateBackend;
  dbPath?: string;
  uiDistDir?: string;
  workspaceDir?: string;
};

const sessionCookieName = 'docstube_session';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

const createSessionToken = (): string => randomBytes(18).toString('hex');

const cookieValue = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }

  return undefined;
};

const requestHasSession = (input: {
  cookie?: string;
  headerToken?: string;
  queryToken?: string;
  sessionToken: string;
}): boolean =>
  input.queryToken === input.sessionToken ||
  input.headerToken === input.sessionToken ||
  cookieValue(input.cookie, sessionCookieName) === input.sessionToken;

const resolveStaticPath = (uiDistDir: string, requestPath: string): string | null => {
  const decoded = decodeURIComponent(requestPath);
  const relativePath = decoded === '/' || decoded === '/wizard' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolvedRoot = resolve(uiDistDir);
  const resolvedFile = resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${resolvedRoot.endsWith(sep) ? '' : sep}`;

  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(rootPrefix)) {
    return null;
  }

  return resolvedFile;
};

const staticResponse = async (uiDistDir: string, requestPath: string): Promise<Response> => {
  const staticPath = resolveStaticPath(uiDistDir, requestPath);
  if (!staticPath) {
    return new Response('not found', { status: 404 });
  }

  try {
    const file = await readFile(staticPath);
    return new Response(file, {
      headers: {
        'cache-control': staticPath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
        'content-type': contentTypes[extname(staticPath)] ?? 'application/octet-stream'
      }
    });
  } catch {
    if (extname(requestPath) === '') {
      return staticResponse(uiDistDir, '/');
    }

    return new Response('not found', { status: 404 });
  }
};

const normalizeUiDevServerUrl = (url: string): string => {
  const parsed = new URL(url);
  if (!loopbackHosts.has(parsed.hostname)) {
    throw new Error(`Local UI dev server must run on localhost, received ${parsed.hostname}.`);
  }

  return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
};

const uiDevServerResponse = async (uiDevServerUrl: string, requestUrl: string): Promise<Response> => {
  const request = new URL(requestUrl);
  const target = new URL(`${request.pathname}${request.search}`, uiDevServerUrl);
  const response = await fetch(target);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export const createLocalControlPlaneApp = (options: LocalControlPlaneAppOptions): LocalControlPlaneApp => {
  const sessionToken = options.sessionToken ?? createSessionToken();
  const uiDevServerUrl = options.uiDevServerUrl ? normalizeUiDevServerUrl(options.uiDevServerUrl) : undefined;
  if (!uiDevServerUrl && !options.uiDistDir) {
    throw new Error('Local control plane requires uiDistDir or uiDevServerUrl.');
  }

  const app = new Hono();

  app.use('*', async (context, next) => {
    const queryToken = context.req.query('session');
    const hasSession = requestHasSession({
      sessionToken,
      queryToken,
      headerToken: context.req.header('x-docstube-session'),
      cookie: context.req.header('cookie')
    });

    if (!hasSession) {
      return context.text('invalid docstube session token', 401);
    }

    await next();

    if (queryToken === sessionToken) {
      context.header('set-cookie', `${sessionCookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`);
    }

    return undefined;
  });

  app.all('/trpc/*', (context) =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: context.req.raw,
      router: appRouter,
      createContext: () => ({ backend: options.backend })
    })
  );

  app.get('*', (context) => {
    const requestPath = new URL(context.req.url).pathname;
    if (uiDevServerUrl) {
      return uiDevServerResponse(uiDevServerUrl, context.req.url);
    }

    return staticResponse(options.uiDistDir!, requestPath);
  });

  return { app, sessionToken };
};

const readNodeRequestBody = async (request: IncomingMessage): Promise<Buffer | undefined> => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
};

const webHeadersFromNodeRequest = (request: IncomingMessage): Headers => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }
  return headers;
};

const writeNodeResponse = async (target: ServerResponse, response: Response): Promise<void> => {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => {
    target.setHeader(key, value);
  });

  const body = await response.arrayBuffer();
  target.end(Buffer.from(body));
};

const handleNodeRequest = async (app: Hono, request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const host = request.headers.host ?? '127.0.0.1';
  const url = `http://${host}${request.url ?? '/'}`;
  const body = await readNodeRequestBody(request);
  const requestInit: RequestInit = {
    method: request.method,
    headers: webHeadersFromNodeRequest(request)
  };
  if (body) {
    requestInit.body = body.toString('utf8');
  }

  const webRequest = new Request(url, requestInit);
  await writeNodeResponse(response, await app.fetch(webRequest));
};

const listen = async (server: Server, port: number, host: string): Promise<number> =>
  new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Local control plane did not bind to a TCP address.'));
        return;
      }
      resolvePort(address.port);
    });
  });

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });

const hostForUrl = (host: string): string => (host.includes(':') ? `[${host}]` : host);

const wizardUrl = (input: { host: string; port: number; sessionToken: string }): string =>
  `http://${hostForUrl(input.host)}:${input.port}/wizard?session=${encodeURIComponent(input.sessionToken)}`;

const defaultOpenBrowser: OpenBrowser = (url) => {
  const currentPlatform = platform();
  const command =
    currentPlatform === 'win32'
      ? { file: 'cmd', args: ['/c', 'start', '', url] }
      : currentPlatform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
};

export const startLocalControlPlane = async (
  options: StartLocalControlPlaneOptions
): Promise<StartedLocalControlPlane> => {
  const host = options.host ?? '127.0.0.1';
  if (!loopbackHosts.has(host)) {
    throw new Error(`Local control plane must bind to localhost, received ${host}.`);
  }

  const { app, sessionToken } = createLocalControlPlaneApp(options);
  const server = createServer((request, response) => {
    handleNodeRequest(app, request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : 'internal server error');
    });
  });
  const port = await listen(server, options.port ?? 0, host);
  const url = wizardUrl({ host, port, sessionToken });

  await (options.openBrowser ?? defaultOpenBrowser)(url);

  return {
    host,
    port,
    sessionToken,
    url,
    close: () => closeServer(server)
  };
};

export const startGenerateSession = async (options: GenerateStartupOptions = {}): Promise<StartedLocalControlPlane> => {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const docstubeDir = join(workspaceDir, '.docstube');
  const dbPath = options.dbPath ?? join(docstubeDir, 'db.sqlite');
  await mkdir(docstubeDir, { recursive: true });

  const backend = options.backend ?? createLocalBackend(openDocstubeDatabase(dbPath));
  const ownsBackend = options.backend === undefined;
  const uiDistDir = options.uiDistDir ?? join(workspaceDir, 'apps', 'local-ui', 'dist');
  const uiDevServerUrl = options.uiDevServerUrl ?? process.env.DOCSTUBE_UI_DEV_SERVER_URL;

  if (!uiDevServerUrl) {
    try {
      await stat(uiDistDir);
    } catch {
      throw new Error(`Local UI build not found at ${uiDistDir}. Run pnpm --filter @docstube/web-ui build first.`);
    }
  }

  const started = await startLocalControlPlane({
    backend,
    uiDevServerUrl,
    uiDistDir,
    host: options.host,
    port: options.port,
    sessionToken: options.sessionToken,
    openBrowser: options.openBrowser
  });

  return {
    ...started,
    close: async () => {
      await started.close();
      if (ownsBackend) {
        await backend.close();
      }
    }
  };
};
