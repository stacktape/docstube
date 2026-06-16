import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocstubeConfig } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import { createLocalControlPlaneApp, startLocalControlPlane } from './local-server';
import type { StateBackend } from './state-backend';

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
});

describe('local control plane startup', () => {
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
