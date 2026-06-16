import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createLocalBackend,
  createDeterministicProjectGenerationAdapters,
  createSourceSnapshot,
  detectChangedSources,
  generateProjectDocumentation,
  openDocstubeDatabase,
  readManifestFile,
  refineProjectDocumentation,
  refreshProjectDocumentation,
  resolveDirtyPages
} from '@docstube/core';
import { runGenerateCommand } from './commands/generate-command.ts';
import { runRefreshCommand } from './commands/refresh-command.ts';
import { runRefineCommand } from './commands/refine-command.ts';
import type { CliOutput } from './cli-output.ts';

type ProductSmokeFixture = {
  changedSource: string;
  initialSource: string;
  name: string;
  sourcePath: 'src/toolkit.py' | 'src/toolkit.ts';
  symbol: string;
  token: string;
};

const execFileAsync = promisify(execFile);
const coreFixturePath = (name: string): string =>
  fileURLToPath(new URL(`../../../packages/core/src/fixtures/${name}`, import.meta.url));
const themeCacheRoot = fileURLToPath(new URL('../../../packages/theme/node_modules/.cache/', import.meta.url));
const astroCli = fileURLToPath(new URL('../../../packages/theme/node_modules/astro/bin/astro.mjs', import.meta.url));
const manifestPath = (repoRoot: string): string => join(repoRoot, '.docstube', 'manifest.yml');

const smokeFixtures = [
  {
    name: 'typescript',
    sourcePath: 'src/toolkit.ts',
    symbol: 'renderToolkit',
    token: 'DOCSTUBE_TS_PRODUCT_SMOKE_TOKEN',
    initialSource: [
      'export const renderToolkit = () => "DOCSTUBE_TS_PRODUCT_SMOKE_TOKEN";',
      'export const toolkitLanguage = "typescript";'
    ].join('\n'),
    changedSource: [
      'export const renderToolkit = () => "DOCSTUBE_TS_PRODUCT_SMOKE_TOKEN_v2";',
      'export const toolkitLanguage = "typescript";'
    ].join('\n')
  },
  {
    name: 'python',
    sourcePath: 'src/toolkit.py',
    symbol: 'render_toolkit',
    token: 'DOCSTUBE_PY_PRODUCT_SMOKE_TOKEN',
    initialSource: [
      'def render_toolkit() -> str:',
      '    return "DOCSTUBE_PY_PRODUCT_SMOKE_TOKEN"',
      '',
      'TOOLKIT_LANGUAGE = "python"'
    ].join('\n'),
    changedSource: [
      'def render_toolkit() -> str:',
      '    return "DOCSTUBE_PY_PRODUCT_SMOKE_TOKEN_v2"',
      '',
      'TOOLKIT_LANGUAGE = "python"'
    ].join('\n')
  }
] as const satisfies readonly ProductSmokeFixture[];

const captureOutput = (): { lines: string[]; output: CliOutput } => {
  const lines: string[] = [];
  return {
    lines,
    output: {
      error: (message) => lines.push(`error:${message}`),
      info: (message) => lines.push(`info:${message}`)
    }
  };
};

const deterministicGenerate = (input: { configPath?: string; workspaceDir: string }) =>
  generateProjectDocumentation({ ...input, adapterFactory: createDeterministicProjectGenerationAdapters });

const deterministicRefresh = (input: { configPath?: string; workspaceDir: string }) =>
  refreshProjectDocumentation({ ...input, adapterFactory: createDeterministicProjectGenerationAdapters });

const deterministicRefine = (input: {
  configPath?: string;
  failedOnly?: boolean;
  maxRounds?: number;
  target?: string;
  workspaceDir: string;
}) => refineProjectDocumentation({ ...input, adapterFactory: createDeterministicProjectGenerationAdapters });

const writeConfigFamily = async (repoRoot: string): Promise<void> => {
  await Promise.all([
    copyFile(coreFixturePath('docstube.yml'), join(repoRoot, 'docstube.yml')),
    copyFile(coreFixturePath('ia.yml'), join(repoRoot, 'ia.yml')),
    copyFile(coreFixturePath('glossary.yaml'), join(repoRoot, 'glossary.yaml'))
  ]);
};

const writeSource = async (repoRoot: string, fixture: ProductSmokeFixture, source: string): Promise<void> => {
  const path = join(repoRoot, ...fixture.sourcePath.split('/'));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${source}\n`, 'utf8');
};

const makeFixtureRepo = async (fixture: ProductSmokeFixture): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), `docstube-${fixture.name}-smoke-`));
  await writeConfigFamily(repoRoot);
  await writeSource(repoRoot, fixture, fixture.initialSource);
  return repoRoot;
};

const runCliGenerate = async (repoRoot: string): Promise<readonly string[]> => {
  const output = captureOutput();
  const result = await runGenerateCommand({ workspaceDir: repoRoot, generate: deterministicGenerate }, output.output);

  expect(result.exitCode).toBe(0);
  expect(output.lines.some((line) => line.includes('Generated 2 pages for run-'))).toBe(true);
  return output.lines;
};

const prepareGeneratedSiteBuild = async (repoRoot: string, fixture: ProductSmokeFixture): Promise<string> => {
  await mkdir(themeCacheRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(themeCacheRoot, `product-smoke-generated-${fixture.name}-`));
  const siteRoot = join(tempRoot, 'site');
  await cp(join(repoRoot, 'docs'), siteRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = source.slice(join(repoRoot, 'docs').length).replaceAll('\\', '/');
      return !['dist', '.astro', 'node_modules'].some(
        (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`)
      );
    }
  });

  return tempRoot;
};

const buildGeneratedSite = async (repoRoot: string, fixture: ProductSmokeFixture): Promise<string> => {
  const tempRoot = await prepareGeneratedSiteBuild(repoRoot, fixture);
  try {
    const siteRoot = join(tempRoot, 'site');
    await execFileAsync(execPath, [astroCli, 'build'], {
      cwd: siteRoot,
      env: { ...env, CI: '1', NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024
    });
    await execFileAsync(execPath, [join(siteRoot, 'scripts', 'postbuild.mjs')], {
      cwd: siteRoot,
      env: { ...env, CI: '1', NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024
    });
    await expect(readFile(join(siteRoot, 'dist', 'llms.txt'), 'utf8')).resolves.toContain('Acme Toolkit');
    await expect(readFile(join(siteRoot, 'dist', 'sitemap.xml'), 'utf8')).resolves.toContain('https://docs.acme.dev/');
    await expect(readFile(join(siteRoot, 'dist', 'pagefind', 'pagefind.js'), 'utf8')).resolves.toContain('pagefind');
    return readFile(join(siteRoot, 'dist', 'index.html'), 'utf8');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const runCliRefreshAndResolveDirtyPages = async (repoRoot: string, fixture: ProductSmokeFixture): Promise<void> => {
  const previous = createSourceSnapshot({
    content: `${fixture.initialSource}\n`,
    path: fixture.sourcePath,
    symbols: { [fixture.symbol]: fixture.initialSource }
  });
  await writeSource(repoRoot, fixture, fixture.changedSource);

  const output = captureOutput();
  const refresh = await runRefreshCommand({ workspaceDir: repoRoot, refresh: deterministicRefresh }, output.output);
  expect(refresh.exitCode).toBe(0);
  expect(output.lines).toContain('info:Loaded manifest with 2 pages.');
  expect(output.lines.some((line) => line.startsWith('info:regenerated: overview'))).toBe(true);

  const changed = detectChangedSources({
    current: [
      createSourceSnapshot({
        content: `${fixture.changedSource}\n`,
        path: fixture.sourcePath,
        symbols: { [fixture.symbol]: fixture.changedSource }
      })
    ],
    previous: [previous]
  });
  const manifest = await readManifestFile(manifestPath(repoRoot));
  expect(manifest.pages.find((page) => page.id === 'overview')).toMatchObject({ status: 'passed' });
  const dirty = resolveDirtyPages({ changedSources: changed, manifest });

  expect(changed).toMatchObject([{ kind: 'modified', path: fixture.sourcePath }]);
  expect(dirty.dirtyPageIds).toEqual(['overview']);
  expect(dirty.decisions.find((decision) => decision.pageId === 'overview')?.reasons).toContain(
    'changed-provenance-input'
  );
};

const flagOverviewForRefinement = async (repoRoot: string): Promise<void> => {
  const backend = createLocalBackend(openDocstubeDatabase(join(repoRoot, '.docstube', 'db.sqlite')));
  try {
    const page = await backend.getPage('overview');
    if (!page) {
      throw new Error('overview page missing before refinement smoke');
    }

    await backend.upsertPage({
      ...page,
      status: 'flagged',
      findings: [
        {
          code: 'product-smoke-refine',
          severity: 'major',
          origin: 'verifier',
          message: 'Product smoke injected a refinement finding.',
          pageId: 'overview',
          location: { path: page.slug ?? 'docs/src/pages/index.mdx' }
        }
      ],
      updatedAt: '2026-06-16T00:00:00.000Z'
    });
  } finally {
    await backend.close();
  }
};

const runCliRefineFailedPage = async (repoRoot: string): Promise<void> => {
  await flagOverviewForRefinement(repoRoot);
  const output = captureOutput();
  const result = await runRefineCommand(
    {
      workspaceDir: repoRoot,
      failed: true,
      maxRounds: 1,
      refine: deterministicRefine
    },
    output.output
  );

  expect(result.exitCode).toBe(0);
  expect(output.lines).toContain('info:Ranked 2 refinement candidates.');
  expect(output.lines).toContain('info:refined: overview status=passed path=docs/src/pages/index.mdx');
};

describe('deterministic product smoke', () => {
  it.each(smokeFixtures)(
    'runs the $name fixture through CLI generate, site build, and refresh',
    async (fixture) => {
      const repoRoot = await makeFixtureRepo(fixture);
      try {
        await runCliGenerate(repoRoot);
        const generatedMdx = await readFile(join(repoRoot, 'docs', 'src', 'pages', 'index.mdx'), 'utf8');
        const expectedMdxTokens = [
          'Source facts:',
          fixture.sourcePath,
          fixture.symbol,
          ...(fixture.name === 'typescript' ? [fixture.token] : [])
        ];
        for (const token of expectedMdxTokens) {
          expect(generatedMdx).toContain(token);
        }

        const manifest = await readManifestFile(manifestPath(repoRoot));
        const overview = manifest.pages.find((page) => page.id === 'overview');
        expect(overview).toMatchObject({ id: 'overview', path: 'docs/src/pages/index.mdx', status: 'passed' });
        expect(overview?.provenance.reads).toEqual([fixture.sourcePath]);
        expect(overview?.provenance.citations).toContainEqual({ path: fixture.sourcePath, symbol: fixture.symbol });

        const html = await buildGeneratedSite(repoRoot, fixture);
        expect(html).toContain(fixture.name === 'typescript' ? fixture.token : fixture.symbol);
        expect(html).toContain('Generated by <a href="https://docstube.dev">docstube</a>');

        await runCliRefreshAndResolveDirtyPages(repoRoot, fixture);
        await runCliRefineFailedPage(repoRoot);
      } finally {
        await rm(repoRoot, { recursive: true, force: true });
      }
    },
    120_000
  );
});
