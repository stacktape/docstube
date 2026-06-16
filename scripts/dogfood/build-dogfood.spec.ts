import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

      const result = await buildDogfoodDocs({ outputDir: 'dogfood-out', workspaceDir: dir });
      const html = await readFile(join(result.outputDir, 'docs', 'index.html'), 'utf8');
      const manifest = JSON.parse(await readFile(join(result.outputDir, 'manifest.json'), 'utf8')) as {
        reviewRequired?: unknown;
        taskCount?: unknown;
      };

      expect(result.files).toHaveLength(3);
      expect(html).toContain('docstube dogfood docs');
      expect(html).toContain('No live agents');
      expect(html).not.toContain('sk-');
      expect(manifest.reviewRequired).toBe(true);
      expect(typeof manifest.taskCount).toBe('number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
