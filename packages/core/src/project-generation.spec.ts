import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readManifestFile } from './incremental-engine.ts';
import { createPageGenerationContext } from './page-generation-context.ts';
import {
  createConfiguredProjectGenerationAdapters,
  createDeterministicProjectGenerationAdapters,
  generateProjectDocumentation,
  initializeProjectGeneration
} from './project-generation.ts';
import { loadProjectConfigFamily } from './project-workspace.ts';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const withWorkspace = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-project-generation-'));
  try {
    await Promise.all([
      copyFile(fixturePath('docstube.yml'), join(dir, 'docstube.yml')),
      copyFile(fixturePath('ia.yml'), join(dir, 'ia.yml')),
      copyFile(fixturePath('glossary.yaml'), join(dir, 'glossary.yaml'))
    ]);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('initializeProjectGeneration', () => {
  it('initializes and resumes project generation state from the config family', async () => {
    await withWorkspace(async (workspaceDir) => {
      const first = await initializeProjectGeneration({ workspaceDir });
      const second = await initializeProjectGeneration({ workspaceDir });

      expect(first).toMatchObject({
        pagesCount: 2,
        resumed: false
      });
      expect(second).toEqual({
        pagesCount: 2,
        resumed: true,
        runId: first.runId
      });
    });
  });

  it('generates deterministic MDX pages, state, and a portable manifest', async () => {
    await withWorkspace(async (workspaceDir) => {
      await mkdir(join(workspaceDir, 'src'), { recursive: true });
      await writeFile(join(workspaceDir, 'src', 'toolkit.ts'), 'export const toolkit = "acme";\n', 'utf8');

      const first = await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });
      const second = await generateProjectDocumentation({
        workspaceDir,
        adapterFactory: createDeterministicProjectGenerationAdapters
      });

      expect(first).toMatchObject({
        pagesCount: 2,
        resumed: false,
        sourceFilesCount: 1
      });
      expect(second).toMatchObject({
        pagesCount: 2,
        resumed: true,
        runId: first.runId
      });
      await expect(readFile(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain(
        'layout: "../layouts/DocLayout.astro"'
      );
      await expect(readFile(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain(
        'Source facts:'
      );
      await expect(readFile(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain(
        'toolkit (const'
      );
      await expect(
        readFile(join(workspaceDir, 'docs', 'src', 'pages', 'guides', 'install.mdx'), 'utf8')
      ).resolves.toContain('## Install');
      await expect(readFile(join(workspaceDir, 'docs', 'astro.config.mjs'), 'utf8')).resolves.toContain('defineConfig');

      const manifest = await readManifestFile(join(workspaceDir, '.docstube', 'manifest.yml'));
      expect(manifest.pages.map((page) => [page.id, page.path, page.status])).toEqual([
        ['guides/install', 'docs/src/pages/guides/install.mdx', 'passed'],
        ['overview', 'docs/src/pages/index.mdx', 'passed']
      ]);
      expect(manifest.pages.find((page) => page.id === 'guides/install')?.provenance.reads).toEqual([]);
      expect(manifest.pages.find((page) => page.id === 'overview')?.provenance.reads).toEqual(['src/toolkit.ts']);
      expect(manifest.pages.find((page) => page.id === 'overview')?.provenance.citations).toEqual([
        { path: 'src/toolkit.ts', symbol: 'toolkit' }
      ]);
      await expect(readdir(join(workspaceDir, '.docstube', 'cache', 'agents'))).resolves.not.toHaveLength(0);
      await expect(
        readFile(
          join(workspaceDir, '.docstube', 'runs', first.runId, 'transcripts', 'writer-overview-attempt-0.json'),
          'utf8'
        )
      ).resolves.toContain('"taskId": "writer-overview"');
    });
  });

  it('uses real API extractors in page generation context when available', async () => {
    await withWorkspace(async (workspaceDir) => {
      await mkdir(join(workspaceDir, 'src'), { recursive: true });
      const source = 'export function add(left: number, right: number): number { return left + right; }\n';
      await writeFile(join(workspaceDir, 'src', 'toolkit.ts'), source, 'utf8');
      const family = await loadProjectConfigFamily(workspaceDir);

      const context = await createPageGenerationContext({
        config: family.config,
        glossary: family.glossary,
        page: {
          id: 'overview',
          title: 'Overview',
          slug: 'docs/src/pages/index.mdx',
          depth: 0,
          order: 0
        },
        sources: [
          {
            path: 'src/toolkit.ts',
            content: source,
            hash: '6c459e3ea1cab7d44f60bf914a96a75145d4a35069e7f0f48f43585b1e43c8d5'
          }
        ],
        workspaceDir
      });

      expect(context.apiSymbols).toContainEqual(
        expect.objectContaining({
          name: 'add',
          sourcePath: 'src/toolkit.ts',
          source: 'typedoc'
        })
      );
    });
  });

  it('resolves IA and glossary paths relative to a nested config file', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-nested-config-'));
    try {
      await mkdir(join(workspaceDir, 'config'), { recursive: true });
      await Promise.all([
        copyFile(fixturePath('docstube.yml'), join(workspaceDir, 'config', 'docstube.yml')),
        copyFile(fixturePath('ia.yml'), join(workspaceDir, 'config', 'ia.yml')),
        copyFile(fixturePath('glossary.yaml'), join(workspaceDir, 'config', 'glossary.yaml'))
      ]);

      const result = await generateProjectDocumentation({
        workspaceDir,
        configPath: 'config/docstube.yml',
        adapterFactory: createDeterministicProjectGenerationAdapters
      });

      expect(result.pagesCount).toBe(2);
      await expect(readFile(join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'), 'utf8')).resolves.toContain(
        '## Overview'
      );
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('uses configured adapters for production generation by default', async () => {
    const configFamily = await loadProjectConfigFamily(fileURLToPath(new URL('./fixtures/', import.meta.url)));
    const adapters = createConfiguredProjectGenerationAdapters({
      config: configFamily.config,
      generatedAt: '2026-06-16T00:00:00.000Z',
      pages: [],
      sourceFiles: [],
      workspaceDir: fileURLToPath(new URL('./fixtures/', import.meta.url))
    });

    expect(adapters.writer.id).toBe('codex');
    expect(adapters.reviewers.map((reviewer) => reviewer.adapter.id)).toEqual(['claude', 'claude']);
  });

  it('requires explicit provider models for direct API adapters', async () => {
    const configFamily = await loadProjectConfigFamily(fileURLToPath(new URL('./fixtures/', import.meta.url)));

    expect(() =>
      createConfiguredProjectGenerationAdapters({
        config: {
          ...configFamily.config,
          agents: { writer: { adapter: 'api', provider: 'openai' } }
        },
        generatedAt: '2026-06-16T00:00:00.000Z',
        pages: [],
        sourceFiles: [],
        workspaceDir: fileURLToPath(new URL('./fixtures/', import.meta.url))
      })
    ).toThrow('direct API adapter requires');
  });
});
