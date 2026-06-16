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
  createGeneratedSiteAssets,
  createGlossaryRemarkPlugin,
  createCanonicalUrl,
  createLlmsFullText,
  createLlmsText,
  createSeoMetadata,
  createSitemapXml,
  defaultThemeLayout,
  docstubeThemeRegistry,
  renderD2DiagramSvg,
  stableThemeComponentNames,
  themeComponentPropSchemas,
  themeLayouts,
  writeLlmsFiles,
  writeSeoFiles
} from './theme.ts';
import type { LlmsInput, MarkdownAstNode, SeoInput } from './theme.ts';

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
  'src/pages/credit-disabled.mdx',
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

const fixtureSeoInput: SeoInput = {
  siteName: 'docstube fixture',
  siteUrl: 'https://docs.example.test',
  pages: [
    {
      title: 'Install',
      url: '/guides/install/',
      description: 'Sectioned layout fixture page.'
    },
    {
      title: 'Overview',
      url: '/',
      description: 'Representative generated MDX page.',
      faq: [
        {
          question: 'What does docstube generate?',
          answer: 'A self-contained Astro docs site with verified MDX output.'
        }
      ]
    },
    {
      title: 'Credit Disabled',
      url: '/credit-disabled/',
      description: 'Footer credit opt-out fixture.'
    },
    {
      title: 'Glossary',
      url: '/glossary/',
      description: 'Generated glossary entries.'
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

  it('creates self-contained generated-site assets from IA, glossary, and site metadata', () => {
    const assets = createGeneratedSiteAssets({
      siteName: 'Acme Docs',
      siteDescription: 'Acme generated docs.',
      siteUrl: 'https://docs.acme.test',
      credit: true,
      glossary: {
        version: 1,
        terms: [{ id: 'codemap', term: 'Codemap', definition: 'A structural map.' }]
      },
      ia: {
        version: 1,
        nav: [
          { id: 'overview', title: 'Overview' },
          {
            id: 'guides',
            title: 'Guides',
            children: [{ id: 'install', title: 'Install', path: 'guides/install.mdx' }]
          }
        ]
      }
    });
    const byPath = new Map(assets.map((asset) => [asset.path, asset.content]));

    expect([...byPath.keys()].toSorted()).toEqual([
      'astro.config.mjs',
      'package.json',
      'scripts/postbuild.mjs',
      'src/components/theme-components.tsx',
      'src/layouts/DocLayout.astro',
      'src/theme-build/glossary-data.mjs',
      'src/theme-build/glossary-remark.mjs',
      'src/theme-build/site-data.mjs'
    ]);
    expect(byPath.get('src/theme-build/site-data.mjs')).toContain('"href": "/"');
    expect(byPath.get('src/theme-build/site-data.mjs')).toContain('"href": "/guides/install/"');
    expect(byPath.get('scripts/postbuild.mjs')).toContain('llms.txt');
    expect(byPath.get('scripts/postbuild.mjs')).toContain('pagefind');
    expect(byPath.get('package.json')).toContain('scripts/postbuild.mjs');
    expect(byPath.get('package.json')).not.toContain('@docstube/theme');
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

  it('generates deterministic SEO metadata and sitemap output', () => {
    const overviewPage = fixtureSeoInput.pages[1]!;
    const metadata = createSeoMetadata({ ...fixtureSeoInput, page: overviewPage });

    expect(createCanonicalUrl(fixtureSeoInput.siteUrl, '/guides/install/')).toBe(
      'https://docs.example.test/guides/install/'
    );
    expect(metadata).toMatchObject({
      title: 'Overview | docstube fixture',
      canonicalUrl: 'https://docs.example.test/',
      openGraph: {
        title: 'Overview | docstube fixture',
        type: 'article',
        url: 'https://docs.example.test/'
      }
    });
    expect(metadata.structuredData).toEqual([
      expect.objectContaining({ '@type': 'TechArticle', headline: 'Overview' }),
      expect.objectContaining({ '@type': 'FAQPage' })
    ]);
    expect(createSitemapXml(fixtureSeoInput)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        '    <loc>https://docs.example.test/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>https://docs.example.test/credit-disabled/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>https://docs.example.test/glossary/</loc>',
        '  </url>',
        '  <url>',
        '    <loc>https://docs.example.test/guides/install/</loc>',
        '  </url>',
        '</urlset>',
        ''
      ].join('\n')
    );
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
      await writeSeoFiles(distDir, fixtureSeoInput);
      const pagefind = await buildPagefindSearchIndex({ siteDir: distDir });
      const indexHtml = await readFile(join(fixtureRoot, 'dist', 'index.html'), 'utf8');
      const creditDisabledHtml = await readFile(join(fixtureRoot, 'dist', 'credit-disabled', 'index.html'), 'utf8');
      const installHtml = await readFile(join(fixtureRoot, 'dist', 'guides', 'install', 'index.html'), 'utf8');
      const glossaryHtml = await readFile(join(fixtureRoot, 'dist', 'glossary', 'index.html'), 'utf8');
      const llmsText = await readFile(join(fixtureRoot, 'dist', 'llms.txt'), 'utf8');
      const sitemapXml = await readFile(join(fixtureRoot, 'dist', 'sitemap.xml'), 'utf8');

      expect(pagefind.errors).toEqual([]);
      expect(pagefind.pageCount).toBeGreaterThanOrEqual(4);
      expect(pagefind.files).toContain('pagefind.js');
      expect(indexHtml).toContain('DOCSTUBE_THEME_FIXTURE_TOKEN');
      expect(indexHtml).toContain('data-component="Callout"');
      expect(indexHtml).toContain('data-component="Diagram"');
      expect(indexHtml).toContain('<svg');
      expect(indexHtml).toContain('/glossary/#codemap');
      expect(indexHtml).toContain('/glossary/#deterministic-verifier');
      expect(indexHtml).toContain('<link rel="canonical" href="https://docs.example.test/">');
      expect(indexHtml).toContain('property="og:title" content="Overview | docstube fixture"');
      expect(indexHtml).toContain('"@type":"TechArticle"');
      expect(indexHtml).toContain('"@type":"FAQPage"');
      expect(indexHtml).toContain('What does docstube generate?');
      expect(indexHtml).toContain('Generated by <a href="https://docstube.dev">docstube</a>');
      expect(creditDisabledHtml).not.toContain('Generated by <a href="https://docstube.dev">docstube</a>');
      expect(installHtml).toContain('site-shell--sectioned');
      expect(glossaryHtml).toContain('id="codemap"');
      expect(llmsText).toBe(createLlmsText(fixtureLlmsInput));
      expect(sitemapXml).toBe(createSitemapXml(fixtureSeoInput));
    } finally {
      await cleanFixtureOutputs();
    }
  }, 120_000);
});
