import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checkComponentProps, componentPropsCheckId } from '@docstube/verifiers';
import {
  builtInComponentNames,
  buildPagefindSearchIndex,
  createDocsMcpResources,
  createDocsMcpServer,
  createGlossaryRemarkPlugin,
  createLlmsFullText,
  createLlmsText,
  defaultThemeLayout,
  docstubeThemeRegistry,
  renderD2DiagramSvg,
  stableThemeComponentNames,
  themeComponentPropSchemas,
  themeLayouts,
  writeLlmsFiles
} from './theme';
import type { LlmsInput, MarkdownAstNode } from './theme';

const execFileAsync = promisify(execFile);

const fixtureRoot = fileURLToPath(new URL('../fixtures/generated-site/', import.meta.url));
const astroCli = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
const generatedDir = join(fixtureRoot, 'src', 'generated');
const generatedArtifactsPath = join(generatedDir, 'generated-artifacts.ts');

const cleanFixtureOutputs = async () => {
  await Promise.all([
    rm(join(fixtureRoot, '.astro'), { recursive: true, force: true }),
    rm(join(fixtureRoot, 'dist'), { recursive: true, force: true }),
    rm(join(fixtureRoot, 'node_modules'), { recursive: true, force: true }),
    rm(generatedDir, { recursive: true, force: true })
  ]);
};

const sourceFiles = [
  'astro.config.mjs',
  'src/theme-build/glossary-remark.mjs',
  'src/components/theme-components.tsx',
  'src/layouts/DocLayout.astro',
  'src/pages/index.mdx',
  'src/pages/glossary.mdx',
  'src/pages/guides/install.mdx'
] as const;

const fixtureLlmsInput: LlmsInput = {
  siteName: 'docstube fixture',
  description: 'Generated docs fixture.',
  pages: [
    {
      title: 'Install',
      url: '/guides/install/',
      description: 'Sectioned layout fixture page.',
      content: 'Install docstube, run generation, and review generated pages.'
    },
    {
      title: 'Overview',
      url: '/',
      description: 'Representative generated MDX page.',
      content: 'DOCSTUBE_THEME_FIXTURE_TOKEN\n\nCodemap entries and deterministic verifiers are linked.'
    },
    {
      title: 'Glossary',
      url: '/glossary/',
      description: 'Generated glossary entries.',
      content: 'Codemap: A structural map of the source repository.'
    }
  ]
};

const prepareGeneratedArtifacts = async () => {
  const svg = await renderD2DiagramSvg({
    source: 'source -> writer: facts\nwriter -> docs: MDX\ndocs -> verifier: checks',
    options: { salt: 'docstube-theme-fixture' }
  });

  await mkdir(generatedDir, { recursive: true });
  await writeFile(generatedArtifactsPath, `export const architectureDiagramSvg = ${JSON.stringify(svg)};\n`, 'utf8');
};

describe('docstube theme contract', () => {
  it('registers the built-in component contract and supported layouts', () => {
    expect(themeLayouts).toEqual(['single-tree', 'sectioned']);
    expect(defaultThemeLayout).toBe('single-tree');
    expect(docstubeThemeRegistry.components.map((component) => component.name)).toEqual(builtInComponentNames);

    const screenshot = docstubeThemeRegistry.components.find((component) => component.name === 'Screenshot');
    expect(screenshot?.status).toBe('reserved');
    expect(stableThemeComponentNames).not.toContain('Screenshot');
    expect(Object.keys(themeComponentPropSchemas)).not.toContain('screenshot-props');
  });

  it('validates component usage through shared registry metadata', () => {
    expect(
      checkComponentProps({
        registry: docstubeThemeRegistry,
        propSchemas: themeComponentPropSchemas,
        usages: [
          { name: 'Callout', props: { tone: 'warning', title: 'Careful' } },
          { name: 'Card', props: { title: 'Install', href: '/guides/install/' } },
          {
            name: 'Tabs',
            props: {
              tabs: [
                { label: 'pnpm', value: 'pnpm' },
                { label: 'npm', value: 'npm' }
              ],
              defaultValue: 'pnpm'
            }
          }
        ]
      })
    ).toEqual({ checkId: componentPropsCheckId, status: 'passed' });

    const failed = checkComponentProps({
      registry: docstubeThemeRegistry,
      propSchemas: themeComponentPropSchemas,
      usages: [
        { name: 'Callout', props: { tone: 'loud' } },
        { name: 'Screenshot', props: {} }
      ]
    });

    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' ? failed.findings.map((finding) => finding.message) : []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('tone'),
        'Component is reserved and cannot be used yet: Screenshot'
      ])
    );
  });

  it('links glossary terms through the generated remark plugin', () => {
    const tree: MarkdownAstNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Codemap drives deterministic verifiers.' }]
        }
      ]
    };

    const plugin = createGlossaryRemarkPlugin({
      terms: [
        { id: 'codemap', term: 'Codemap', definition: 'A structural map.' },
        {
          id: 'deterministic-verifier',
          term: 'deterministic verifier',
          definition: 'A non-AI check.',
          aliases: ['deterministic verifiers']
        }
      ]
    });
    plugin()(tree);

    expect(tree.children?.[0]?.children).toEqual([
      {
        type: 'link',
        url: '/glossary/#codemap',
        title: 'A structural map.',
        children: [{ type: 'text', value: 'Codemap' }]
      },
      { type: 'text', value: ' drives ' },
      {
        type: 'link',
        url: '/glossary/#deterministic-verifier',
        title: 'A non-AI check.',
        children: [{ type: 'text', value: 'deterministic verifiers' }]
      },
      { type: 'text', value: '.' }
    ]);
  });

  it('generates deterministic llms files and docs MCP resources', async () => {
    const llmsText = createLlmsText(fixtureLlmsInput);
    const llmsFullText = createLlmsFullText(fixtureLlmsInput);
    expect(llmsText).toBe(
      [
        '# docstube fixture',
        '',
        '> Generated docs fixture.',
        '',
        '## Docs',
        '- [Overview](/): Representative generated MDX page.',
        '- [Glossary](/glossary/): Generated glossary entries.',
        '- [Install](/guides/install/): Sectioned layout fixture page.',
        ''
      ].join('\n')
    );
    expect(createLlmsText(fixtureLlmsInput)).toBe(llmsText);
    expect(llmsFullText).toContain('DOCSTUBE_THEME_FIXTURE_TOKEN');

    const resources = createDocsMcpResources({ ...fixtureLlmsInput, llmsText, llmsFullText });
    const server = createDocsMcpServer(resources);
    expect(server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toMatchObject({
      id: 1,
      result: { capabilities: { resources: {} } }
    });
    expect(server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).toMatchObject({
      id: 2,
      result: {
        resources: expect.arrayContaining([
          { uri: 'docstube://docs/llms.txt', name: 'llms.txt', mimeType: 'text/plain' },
          { uri: 'docstube://docs/', name: 'Overview', mimeType: 'text/markdown' }
        ])
      }
    });
    expect(
      server.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/read',
        params: { uri: 'docstube://docs/llms-full.txt' }
      })
    ).toMatchObject({
      id: 3,
      result: { contents: [{ text: expect.stringContaining('## Overview') }] }
    });
  });

  it('builds the self-contained generated Astro docs-site fixture', async () => {
    const packageJson = JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies ?? {}).not.toHaveProperty('@docstube/theme');
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty('@docstube/theme');

    const sources = await Promise.all(sourceFiles.map((path) => readFile(join(fixtureRoot, path), 'utf8')));
    expect(sources.join('\n')).not.toContain('@docstube/theme');

    await cleanFixtureOutputs();
    try {
      await prepareGeneratedArtifacts();
      await execFileAsync(execPath, [astroCli, 'build'], {
        cwd: fixtureRoot,
        env: { ...env, CI: '1', NO_COLOR: '1' },
        maxBuffer: 10 * 1024 * 1024
      });

      const distDir = join(fixtureRoot, 'dist');
      await writeLlmsFiles(distDir, fixtureLlmsInput);
      const pagefind = await buildPagefindSearchIndex({ siteDir: distDir });
      const indexHtml = await readFile(join(fixtureRoot, 'dist', 'index.html'), 'utf8');
      const installHtml = await readFile(join(fixtureRoot, 'dist', 'guides', 'install', 'index.html'), 'utf8');
      const glossaryHtml = await readFile(join(fixtureRoot, 'dist', 'glossary', 'index.html'), 'utf8');
      const llmsText = await readFile(join(fixtureRoot, 'dist', 'llms.txt'), 'utf8');

      expect(pagefind.errors).toEqual([]);
      expect(pagefind.pageCount).toBeGreaterThanOrEqual(3);
      expect(pagefind.files).toContain('pagefind.js');
      expect(indexHtml).toContain('DOCSTUBE_THEME_FIXTURE_TOKEN');
      expect(indexHtml).toContain('data-component="Callout"');
      expect(indexHtml).toContain('data-component="Diagram"');
      expect(indexHtml).toContain('<svg');
      expect(indexHtml).toContain('/glossary/#codemap');
      expect(indexHtml).toContain('/glossary/#deterministic-verifier');
      expect(installHtml).toContain('site-shell--sectioned');
      expect(glossaryHtml).toContain('id="codemap"');
      expect(llmsText).toBe(createLlmsText(fixtureLlmsInput));
    } finally {
      await cleanFixtureOutputs();
    }
  }, 120_000);
});
