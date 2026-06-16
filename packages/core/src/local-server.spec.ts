import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocstubeConfig } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { openDocstubeDatabase } from './db-migrations.ts';
import { createLocalBackend } from './local-backend.ts';
import { createLocalControlPlaneApp, startGenerateSession, startLocalControlPlane } from './local-server.ts';
import type { StateBackend } from './state-backend.ts';

const config: DocstubeConfig = {
  version: 1,
  site: { name: 'Fixture Docs', locale: 'en' },
  docsType: 'library',
  output: { dir: 'docs', layout: 'single-tree' },
  personas: [{ id: 'developer', title: 'Developer' }],
  agents: { writer: { adapter: 'codex', model: 'fixture' } },
  ia: 'ia.yml',
  glossary: 'glossary.yaml'
};

const withBackend = async (run: (backend: StateBackend) => Promise<void>) => {
  const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
  try {
    await backend.setConfig(config);
    await run(backend);
  } finally {
    await backend.close();
  }
};

const withUiDist = async (run: (uiDistDir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-ui-dist-'));
  try {
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), '<div id="root">docstube local ui</div>', 'utf8');
    await writeFile(join(dir, 'assets', 'app.js'), 'window.__docstube = true;', 'utf8');
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

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

const withUiDevServer = async (run: (uiDevServerUrl: string) => Promise<void>) => {
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'public, max-age=31536000');
    response.setHeader('x-docstube-dev-path', request.url ?? '/');
    if (request.url?.startsWith('/assets/')) {
      response.setHeader('content-type', 'text/javascript; charset=utf-8');
      response.end('window.__docstubeVite = true;');
      return;
    }

    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<div id="root">docstube vite local ui</div>');
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Fixture UI dev server did not bind to a TCP address.');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
};

describe('local control plane app', () => {
  it('serves tRPC through the session-guarded Hono app', async () => {
    await withBackend(async (backend) => {
      await withUiDist(async (uiDistDir) => {
        const { app } = createLocalControlPlaneApp({ backend, uiDistDir, sessionToken: 'test-token' });

        const response = await app.request('/trpc/config.read?session=test-token');
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('Fixture Docs');
      });
    });
  });

  it('rejects invalid session tokens before tRPC handlers run', async () => {
    await withBackend(async (backend) => {
      await withUiDist(async (uiDistDir) => {
        const { app } = createLocalControlPlaneApp({ backend, uiDistDir, sessionToken: 'test-token' });

        const response = await app.request('/trpc/config.read?session=wrong-token');

        expect(response.status).toBe(401);
        expect(await response.text()).toContain('invalid docstube session token');
      });
    });
  });

  it('serves the built local UI and carries the session into static asset requests with a cookie', async () => {
    await withBackend(async (backend) => {
      await withUiDist(async (uiDistDir) => {
        const { app } = createLocalControlPlaneApp({ backend, uiDistDir, sessionToken: 'test-token' });

        const wizard = await app.request('/wizard?session=test-token');
        const cookie = wizard.headers.get('set-cookie')?.split(';')[0];
        const asset = await app.request('/assets/app.js', { headers: { cookie: cookie ?? '' } });

        expect(wizard.status).toBe(200);
        expect(await wizard.text()).toContain('docstube local ui');
        expect(cookie).toBe('docstube_session=test-token');
        expect(asset.status).toBe(200);
        expect(asset.headers.get('content-type')).toContain('text/javascript');
        expect(await asset.text()).toContain('__docstube');
      });
    });
  });

  it('proxies the local UI to a loopback Vite dev server', async () => {
    await withBackend(async (backend) => {
      await withUiDevServer(async (uiDevServerUrl) => {
        const { app } = createLocalControlPlaneApp({
          backend,
          uiDevServerUrl,
          sessionToken: 'test-token'
        });

        const wizard = await app.request('/wizard?session=test-token');
        const cookie = wizard.headers.get('set-cookie')?.split(';')[0];
        const asset = await app.request('/assets/app.js?t=123', { headers: { cookie: cookie ?? '' } });

        expect(wizard.status).toBe(200);
        expect(await wizard.text()).toContain('docstube vite local ui');
        expect(wizard.headers.get('cache-control')).toBe('no-store');
        expect(asset.status).toBe(200);
        expect(asset.headers.get('x-docstube-dev-path')).toBe('/assets/app.js?t=123');
        expect(await asset.text()).toContain('__docstubeVite');
      });
    });
  });
});

describe('local control plane startup', () => {
  it('starts a generate session from staged UI assets outside the workspace', async () => {
    await withUiDist(async (uiDistDir) => {
      const workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-generate-session-'));
      const openedUrls: string[] = [];
      try {
        const started = await startGenerateSession({
          workspaceDir,
          uiDistDir,
          sessionToken: 'staged-token',
          openBrowser: (url) => {
            openedUrls.push(url);
          }
        });

        try {
          const response = await fetch(started.url);

          expect(openedUrls).toEqual([started.url]);
          expect(response.status).toBe(200);
          expect(await response.text()).toContain('docstube local ui');
        } finally {
          await started.close();
        }
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    });
  });

  it('binds to localhost, opens the wizard URL, and serves it over HTTP', async () => {
    await withBackend(async (backend) => {
      await withUiDist(async (uiDistDir) => {
        const openedUrls: string[] = [];
        const started = await startLocalControlPlane({
          backend,
          uiDistDir,
          sessionToken: 'bind-token',
          openBrowser: (url) => {
            openedUrls.push(url);
          }
        });

        try {
          const response = await fetch(started.url);

          expect(started.host).toBe('127.0.0.1');
          expect(started.url).toContain('/wizard?session=bind-token');
          expect(openedUrls).toEqual([started.url]);
          expect(response.status).toBe(200);
          expect(await response.text()).toContain('docstube local ui');
        } finally {
          await started.close();
        }
      });
    });
  });

  it('refuses non-localhost bindings', async () => {
    await withBackend(async (backend) => {
      await withUiDist(async (uiDistDir) => {
        await expect(
          startLocalControlPlane({
            backend,
            uiDistDir,
            host: '0.0.0.0',
            sessionToken: 'bind-token',
            openBrowser: () => {}
          })
        ).rejects.toThrow('must bind to localhost');
      });
    });
  });
});
