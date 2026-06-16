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
  createPageProvenance,
  createS0WalkingSkeletonReplayFixture,
  createSourceSnapshot,
  detectChangedSources,
  openDocstubeDatabase,
  readManifestFile,
  resolveDirtyPages,
  runS0WalkingSkeleton,
  updateManifest,
  writeManifestFile
} from '@docstube/core';
import { runGenerateCommand, runRefreshCommand } from './cli-commands.ts';
import type { CliOutput } from './cli-commands.ts';

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
const themeFixtureRoot = fileURLToPath(new URL('../../../packages/theme/fixtures/generated-site/', import.meta.url));
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
  const result = await runGenerateCommand({ workspaceDir: repoRoot }, output.output);

  expect(result.exitCode).toBe(0);
  expect(output.lines.some((line) => line.includes('Initialized 2 pages for run-'))).toBe(true);
  return output.lines;
};

const runReplayGeneration = async (repoRoot: string, fixture: ProductSmokeFixture): Promise<string> => {
  const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
  try {
    const replay = await createS0WalkingSkeletonReplayFixture(repoRoot, {
      sourcePath: fixture.sourcePath,
      token: fixture.token
    });
    const adapter = {
      id: 'product-smoke-replay',
      version: '0.0.0',
      run: async (input: unknown) => {
        expect(input).toEqual(replay.input);
        return replay.result;
      }
    };
    const result = await runS0WalkingSkeleton({
      adapter,
      backend,
      repoRoot,
      sourcePath: fixture.sourcePath
    });

    expect(result.checkResult).toEqual({ checkId: 'section-presence', status: 'passed' });
    expect(result.html).toContain(fixture.token);
    return readFile(join(repoRoot, 'docs', 'overview.mdx'), 'utf8');
  } finally {
    await backend.close();
  }
};

const writeSmokeManifest = async (repoRoot: string, fixture: ProductSmokeFixture): Promise<void> => {
  const manifest = updateManifest({
    generatedWith: { name: 'docstube', version: '0.0.2' },
    pages: [
      {
        id: 'overview',
        path: 'docs/overview.mdx',
        provenance: createPageProvenance({
          seedContext: { fixture: fixture.name, page: 'overview' },
          reads: [fixture.sourcePath],
          citations: [{ path: fixture.sourcePath, symbol: fixture.symbol }]
        }),
        sections: ['intro'],
        status: 'passed',
        title: 'Overview'
      }
    ]
  });

  await writeManifestFile(manifestPath(repoRoot), manifest);
};

const bodyWithoutFrontmatter = (mdx: string): string => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?(?<body>[\s\S]*)$/u.exec(mdx);
  return match?.groups?.body ?? mdx;
};

const prepareCopiedSite = async (fixture: ProductSmokeFixture, generatedMdx: string): Promise<string> => {
  await mkdir(themeCacheRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(themeCacheRoot, `product-smoke-${fixture.name}-`));
  const siteRoot = join(tempRoot, 'site');
  await cp(themeFixtureRoot, siteRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = source.slice(themeFixtureRoot.length).replaceAll('\\', '/');
      return !['dist', '.astro', 'node_modules'].some(
        (dir) => relativePath === dir || relativePath.startsWith(`${dir}/`)
      );
    }
  });

  await mkdir(join(siteRoot, 'src', 'generated'), { recursive: true });
  await writeFile(
    join(siteRoot, 'src', 'generated', 'generated-artifacts.ts'),
    'export const architectureDiagramSvg = "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1 1\\"></svg>";\n',
    'utf8'
  );
  await writeFile(
    join(siteRoot, 'src', 'pages', `product-smoke-${fixture.name}.mdx`),
    [
      '---',
      'layout: ../layouts/DocLayout.astro',
      `${fixture.name === 'typescript' ? 'title: TypeScript Smoke' : 'title: Python Smoke'}`,
      `description: ${fixture.name} product smoke page.`,
      'layoutMode: single-tree',
      '---',
      '',
      bodyWithoutFrontmatter(generatedMdx)
    ].join('\n'),
    'utf8'
  );

  return tempRoot;
};

const buildCopiedSite = async (fixture: ProductSmokeFixture, generatedMdx: string): Promise<string> => {
  const tempRoot = await prepareCopiedSite(fixture, generatedMdx);
  try {
    const siteRoot = join(tempRoot, 'site');
    await execFileAsync(execPath, [astroCli, 'build'], {
      cwd: siteRoot,
      env: { ...env, CI: '1', NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024
    });
    return readFile(join(siteRoot, 'dist', `product-smoke-${fixture.name}`, 'index.html'), 'utf8');
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
  const refresh = await runRefreshCommand({ workspaceDir: repoRoot }, output.output);
  expect(refresh.exitCode).toBe(0);
  expect(output.lines).toContain('info:Loaded manifest with 1 pages.');

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
  const dirty = resolveDirtyPages({ changedSources: changed, manifest });

  expect(changed).toMatchObject([{ kind: 'modified', path: fixture.sourcePath }]);
  expect(dirty.dirtyPageIds).toEqual(['overview']);
  expect(dirty.decisions[0]?.reasons).toContain('changed-provenance-input');
};

describe('deterministic product smoke', () => {
  it.each(smokeFixtures)(
    'runs the $name fixture through CLI generate, site build, and refresh',
    async (fixture) => {
      const repoRoot = await makeFixtureRepo(fixture);
      try {
        await runCliGenerate(repoRoot);
        const generatedMdx = await runReplayGeneration(repoRoot, fixture);
        expect(generatedMdx).toContain(fixture.token);

        await writeSmokeManifest(repoRoot, fixture);
        const manifest = await readManifestFile(manifestPath(repoRoot));
        expect(manifest.pages).toMatchObject([{ id: 'overview', path: 'docs/overview.mdx', status: 'passed' }]);

        const html = await buildCopiedSite(fixture, generatedMdx);
        expect(html).toContain(fixture.token);
        expect(html).toContain('Generated by <a href="https://docstube.dev">docstube</a>');

        await runCliRefreshAndResolveDirtyPages(repoRoot, fixture);
      } finally {
        await rm(repoRoot, { recursive: true, force: true });
      }
    },
    120_000
  );
});
