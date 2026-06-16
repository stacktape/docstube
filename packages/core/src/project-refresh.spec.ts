import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readManifestFile } from './incremental-engine.ts';
import { createDeterministicProjectGenerationAdapters, generateProjectDocumentation } from './project-generation.ts';
import { refreshProjectDocumentation } from './project-refresh.ts';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-project-refresh-'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'toolkit.ts'), 'export const toolkit = "v1";\n', 'utf8');
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('refreshProjectDocumentation', () => {
  it('regenerates pages whose seed context changed and updates the manifest', async () => {
    await withWorkspace(async (workspaceDir) => {
      await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });
      await writeFile(join(workspaceDir, 'src', 'toolkit.ts'), 'export const toolkit = "v2";\n', 'utf8');

      const result = await refreshProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });

      expect(result.changedPages.map((page) => [page.id, page.action, page.reasons])).toEqual([
        ['overview', 'regenerated', ['seed-context-changed']]
      ]);
      expect(result.topologyFindings).toEqual([]);
      await expect(readFile(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain(
        'src/toolkit.ts'
      );
      expect(result.assetRefresh).toEqual(
        expect.objectContaining({
          status: 'refreshed',
          files: expect.arrayContaining(['docs/astro.config.mjs', 'docs/src/layouts/DocLayout.astro'])
        })
      );
      const manifest = await readManifestFile(join(workspaceDir, '.docstube', 'manifest.yml'));
      expect(manifest.pages.every((page) => page.status === 'passed')).toBe(true);
    });
  });

  it('flags missing generated page files through the topology pass', async () => {
    await withWorkspace(async (workspaceDir) => {
      await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });
      await unlink(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'));

      const result = await refreshProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });

      expect(result.changedPages).toContainEqual(
        expect.objectContaining({
          id: 'overview',
          action: 'flagged',
          reasons: ['topology-findings']
        })
      );
      expect(result.topologyFindings).toMatchObject([{ code: 'generated-page-missing', pageId: 'overview' }]);
      const manifest = await readManifestFile(join(workspaceDir, '.docstube', 'manifest.yml'));
      expect(manifest.pages.find((page) => page.id === 'overview')?.status).toBe('flagged');
    });
  });
});
