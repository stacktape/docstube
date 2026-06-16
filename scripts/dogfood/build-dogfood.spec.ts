import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@docstube/core';
import { describe, expect, it } from 'vitest';
import { buildDogfoodDocs } from './build-dogfood.ts';

const repoFile = (name: string): string => fileURLToPath(new URL(`../../${name}`, import.meta.url));

describe('dogfood docs builder', () => {
  it('creates a reviewable static artifact without live agents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'docstube-dogfood-'));
    try {
      await Promise.all([
        copyFile(repoFile('PLAN.md'), join(dir, 'PLAN.md')),
        copyFile(repoFile('tasks.md'), join(dir, 'tasks.md')),
        copyFile(repoFile('package.json'), join(dir, 'package.json'))
      ]);

      const result = await buildDogfoodDocs({ core, outputDir: 'dogfood-out', workspaceDir: dir });
      const html = await readFile(join(result.siteDistDir!, 'index.html'), 'utf8');
      const mdx = await readFile(join(result.siteDir, 'src', 'pages', 'index.mdx'), 'utf8');
      const manifest = JSON.parse(await readFile(join(result.outputDir, 'manifest.json'), 'utf8')) as {
        generatedPages?: unknown;
        liveAgents?: unknown;
        reviewRequired?: unknown;
        siteBuilt?: unknown;
        taskCount?: unknown;
      };

      expect(result.generatedPages).toEqual([
        { id: 'overview', path: 'docs/src/pages/index.mdx', status: 'passed' },
        { id: 'tasks', path: 'docs/src/pages/tasks.mdx', status: 'passed' }
      ]);
      expect(result.files).toContain('workspace/docs/dist/index.html');
      expect(result.files).toContain('workspace/docs/dist/llms.txt');
      expect(result.files).toContain('workspace/docs/dist/pagefind/pagefind.js');
      expect(result.files).toContain('workspace/docs/dist/sitemap.xml');
      expect(html).toContain('docstube dogfood');
      expect(mdx).toContain('Source facts:');
      expect(mdx).toContain('src/PLAN.md');
      expect(html).not.toContain('sk-');
      expect(manifest.generatedPages).toHaveLength(2);
      expect(manifest.liveAgents).toBe(false);
      expect(manifest.reviewRequired).toBe(true);
      expect(manifest.siteBuilt).toBe(true);
      expect(typeof manifest.taskCount).toBe('number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
