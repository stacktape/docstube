import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticHandler, distIsStale, resolveStaticFile, runPreviewCommand } from './preview-command.ts';
import type { CliOutput } from '../cli-output.ts';

let siteDir: string;

const silentOutput = (): CliOutput & { errors: string[] } => {
  const errors: string[] = [];
  return { info: () => {}, error: (message: string) => errors.push(message), errors };
};

beforeEach(async () => {
  siteDir = await mkdtemp(join(tmpdir(), 'docstube-preview-'));
  await mkdir(join(siteDir, 'dist', 'getting-started'), { recursive: true });
  await writeFile(join(siteDir, 'package.json'), JSON.stringify({ name: 'site' }));
  await writeFile(join(siteDir, 'dist', 'index.html'), '<h1>home</h1>');
  await writeFile(join(siteDir, 'dist', 'getting-started', 'index.html'), '<h1>gs</h1>');
  await writeFile(join(siteDir, 'dist', 'styles.css'), 'body{}');
});

afterEach(async () => {
  await rm(siteDir, { recursive: true, force: true });
});

describe('resolveStaticFile', () => {
  it('routes directory-style pages, root, and assets', () => {
    const dist = join(siteDir, 'dist');
    expect(resolveStaticFile(dist, '/')).toBe(join(dist, 'index.html'));
    expect(resolveStaticFile(dist, '/getting-started')).toBe(join(dist, 'getting-started', 'index.html'));
    expect(resolveStaticFile(dist, '/getting-started/')).toBe(join(dist, 'getting-started', 'index.html'));
    expect(resolveStaticFile(dist, '/styles.css?v=1')).toBe(join(dist, 'styles.css'));
    expect(resolveStaticFile(dist, '/missing')).toBeUndefined();
  });

  it('never escapes dist, even through encoded traversal', () => {
    const dist = join(siteDir, 'dist');
    expect(resolveStaticFile(dist, '/../package.json')).toBeUndefined();
    expect(resolveStaticFile(dist, '/%2e%2e/package.json')).toBeUndefined();
  });
});

describe('createStaticHandler', () => {
  it('serves content with mime types and 404s unknown paths', async () => {
    const handler = createStaticHandler(join(siteDir, 'dist'));
    const page = await handler('/getting-started');
    expect(page.status).toBe(200);
    expect(page.contentType).toContain('text/html');
    expect(page.body.toString()).toContain('gs');
    const css = await handler('/styles.css');
    expect(css.contentType).toContain('text/css');
    expect((await handler('/nope')).status).toBe(404);
  });
});

describe('distIsStale', () => {
  it('is fresh right after build, stale after a content edit, stale without dist', async () => {
    expect(await distIsStale(siteDir)).toBe(false);
    const content = join(siteDir, 'content');
    await mkdir(content, { recursive: true });
    const edited = join(content, 'page.mdx');
    await writeFile(edited, '# hi');
    const future = new Date(Date.now() + 60_000);
    await utimes(edited, future, future);
    expect(await distIsStale(siteDir)).toBe(true);
    await rm(join(siteDir, 'dist'), { recursive: true, force: true });
    expect(await distIsStale(siteDir)).toBe(true);
  });
});

describe('runPreviewCommand', () => {
  it('serves a fresh dist end-to-end without touching npm', async () => {
    // workspaceDir has no docstube.yml — preview still works because the site is self-contained.
    const workspace = await mkdtemp(join(tmpdir(), 'docstube-preview-ws-'));
    try {
      await rm(join(workspace, 'docs-site'), { recursive: true, force: true });
      await mkdir(workspace, { recursive: true });
      const target = join(workspace, 'docs-site');
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'site' }));
      await mkdir(join(target, 'dist'), { recursive: true });
      await writeFile(join(target, 'dist', 'index.html'), '<h1>served</h1>');

      const result = (await runPreviewCommand({ workspaceDir: workspace, openBrowser: false }, silentOutput())) as {
        exitCode: number;
        server?: Server;
        url?: string;
      };
      expect(result.exitCode).toBe(0);
      expect(result.url).toMatch(/^http:\/\/localhost:\d+\/$/);
      const response = await fetch(result.url!);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('served');
      result.server?.close();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('fails with guidance when no site exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'docstube-preview-empty-'));
    try {
      const output = silentOutput();
      const result = await runPreviewCommand({ workspaceDir: workspace, openBrowser: false }, output);
      expect(result.exitCode).toBe(1);
      expect(output.errors[0]).toContain('docstube generate');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
