import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalApp, startLocalServer } from './local-server.ts';

const token = 'test-session-token';

const makeRepoRoot = () => mkdtemp(join(tmpdir(), 'docstube-local-server-'));

describe('session guard', () => {
  it('rejects /api requests without a token', async () => {
    const app = createLocalApp({ repoRoot: await makeRepoRoot(), sessionToken: token });
    const response = await app.request('/api/health');
    expect(response.status).toBe(401);
  });

  it('rejects /api requests with a wrong token', async () => {
    const app = createLocalApp({ repoRoot: await makeRepoRoot(), sessionToken: token });
    const viaHeader = await app.request('/api/health', { headers: { 'x-docstube-session': 'wrong' } });
    expect(viaHeader.status).toBe(401);
  });

  it('accepts the token via header only — query params leak into logs and history', async () => {
    const app = createLocalApp({ repoRoot: await makeRepoRoot(), sessionToken: token });
    const viaHeader = await app.request('/api/health', { headers: { 'x-docstube-session': token } });
    expect(viaHeader.status).toBe(200);
    expect(await viaHeader.json()).toEqual({ ok: true });
    const viaQuery = await app.request(`/api/health?session=${token}`);
    expect(viaQuery.status).toBe(401);
  });

  it('guards the tRPC endpoint with the same token', async () => {
    const app = createLocalApp({ repoRoot: await makeRepoRoot(), sessionToken: token });
    const rejected = await app.request('/api/trpc/runs.list');
    expect(rejected.status).toBe(401);
    const accepted = await app.request('/api/trpc/runs.list', { headers: { 'x-docstube-session': token } });
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { result: { data: unknown[] } };
    expect(body.result.data).toEqual([]);
  });
});

describe('control plane context injection', () => {
  it('threads injected capabilities into tRPC procedures', async () => {
    const launched: string[] = [];
    // The control plane owns the run id now (it holds the workspace run lock under it), so the
    // host journals the run under `handle.runId` and releases when the run settles.
    let handedRunId: string | undefined;
    const app = createLocalApp({
      repoRoot: await makeRepoRoot(),
      sessionToken: token,
      controlPlane: {
        launchRun: async (mode, handle) => {
          launched.push(mode);
          handedRunId = handle.runId;
          await handle.release();
        }
      }
    });
    const response = await app.request('/api/trpc/runs.start', {
      method: 'POST',
      headers: { 'x-docstube-session': token, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'generate' })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { data: { runId: string; started: boolean } } };
    expect(body.result.data.runId).toBe(handedRunId);
    expect(body.result.data.started).toBe(true);
    expect(launched).toEqual(['generate']);
  });

  it('returns a clean precondition error when a capability is not injected', async () => {
    const app = createLocalApp({ repoRoot: await makeRepoRoot(), sessionToken: token });
    const response = await app.request('/api/trpc/runs.start', {
      method: 'POST',
      headers: { 'x-docstube-session': token, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'generate' })
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/agent runner not configured/);
  });
});

describe('static UI serving', () => {
  it('serves the built UI with SPA fallback and blocks traversal', async () => {
    const repoRoot = await makeRepoRoot();
    const distDir = join(repoRoot, 'ui-dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>docstube</title>', 'utf8');
    await writeFile(join(distDir, 'app.js'), 'console.info("ui");', 'utf8');
    const app = createLocalApp({ repoRoot, sessionToken: token, uiDistDir: distDir });

    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');

    const asset = await app.request('/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');

    const fallback = await app.request('/some/spa/route');
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain('docstube');

    const traversal = await app.request('/..%2f..%2fdocstube.yml');
    expect(traversal.status).not.toBe(200);
  });
});

describe('startLocalServer', () => {
  it('binds loopback on a random port and returns a tokened URL', async () => {
    const server = await startLocalServer({ repoRoot: await makeRepoRoot() });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.apiBaseUrl).toBe(`http://127.0.0.1:${server.port}`);
      // The token rides in the fragment so it never appears in request lines or server logs.
      expect(server.url).toBe(`${server.apiBaseUrl}/#session=${server.sessionToken}`);
      const denied = await fetch(`${server.apiBaseUrl}/api/health`);
      expect(denied.status).toBe(401);
      const allowed = await fetch(`${server.apiBaseUrl}/api/health`, {
        headers: { 'x-docstube-session': server.sessionToken }
      });
      expect(allowed.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('points the tokened URL at the Vite dev server when one is provided', async () => {
    const server = await startLocalServer({
      repoRoot: await makeRepoRoot(),
      uiDevServerUrl: 'http://127.0.0.1:5173'
    });
    try {
      expect(server.url).toBe(
        `http://127.0.0.1:5173/#session=${server.sessionToken}&api=${encodeURIComponent(server.apiBaseUrl)}`
      );
    } finally {
      await server.close();
    }
  });
});
