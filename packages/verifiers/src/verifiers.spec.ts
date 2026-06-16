import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSectionMarker } from '@docstube/contracts';
import type { CheckResult, ComponentRegistry } from '@docstube/contracts';
import {
  checkComponentProps,
  checkApiReferenceConsistency,
  checkConfigFamily,
  checkD2,
  checkGeneratedPageFrontmatter,
  checkGeneratedPageSections,
  checkGlossaryRules,
  checkImportPaths,
  checkLinks,
  checkMdxCompiles,
  checkPageAndSectionIds,
  checkPythonSnippet,
  checkTypeScriptSnippet,
  compileGeneratedMdxPageToHtml,
  apiReferenceConsistencyCheckId,
  d2CheckId,
  glossaryRulesCheckId,
  importPathCheckId,
  linkCheckId,
  componentPropsCheckId,
  configFamilyCheckId,
  foundationalVerifierRegistry,
  generatedFrontmatterCheckId,
  generatedPageSectionCheckId,
  mdxCompileCheckId,
  pageSectionIdCheckId,
  pythonSnippetCheckId,
  typescriptSnippetCheckId
} from './verifiers.ts';
import type { GeneratedMdxPage } from './verifiers.ts';

const page: GeneratedMdxPage = {
  path: 'docs/overview.mdx',
  frontmatter: {
    id: 'overview',
    title: 'Overview',
    sections: ['intro'],
    generated: {
      by: 'docstube',
      version: '0.0.2',
      at: '2026-06-16T00:00:00.000Z'
    }
  },
  body: [
    buildSectionMarker('start', 'intro'),
    '',
    '## Overview',
    '',
    'DOCSTUBE_S0_WALKING_SKELETON_TOKEN',
    '',
    buildSectionMarker('end', 'intro')
  ].join('\n')
};

const validConfig = {
  site: { name: 'Acme Toolkit' },
  docsType: 'library',
  personas: [{ id: 'developer', title: 'Application developer' }],
  agents: { writer: { adapter: 'codex' } }
};

const validIa = {
  nav: [{ id: 'overview', title: 'Overview' }]
};

const validGlossary = {
  terms: [{ id: 'codemap', term: 'Codemap', definition: 'A structural map of the source repo.' }]
};

const failedSectionIds = (
  result: Awaited<ReturnType<typeof checkMdxCompiles>> | ReturnType<typeof checkGeneratedPageSections>
) => (result.status === 'failed' ? result.findings.map((finding) => finding.sectionId).toSorted() : []);

const findingMessages = (result: CheckResult) =>
  result.status === 'failed' ? result.findings.map((finding) => finding.message) : [];

describe('verifier registry', () => {
  it('lists foundational verifiers and reports unknown checks as errored', async () => {
    expect(foundationalVerifierRegistry.list().map((verifier) => verifier.id)).toEqual([
      componentPropsCheckId,
      configFamilyCheckId,
      generatedFrontmatterCheckId,
      mdxCompileCheckId,
      pageSectionIdCheckId,
      generatedPageSectionCheckId
    ]);

    expect(await foundationalVerifierRegistry.run('missing-check', {})).toEqual({
      checkId: 'missing-check',
      status: 'errored',
      error: 'unknown verifier: missing-check'
    });
  });
});

describe('content deterministic verifiers', () => {
  it('checks TypeScript snippets with the TypeScript compiler', () => {
    expect(checkTypeScriptSnippet({ path: 'snippets/example.ts', code: 'const value: number = 1;' })).toEqual({
      checkId: typescriptSnippetCheckId,
      status: 'passed'
    });

    const failed = checkTypeScriptSnippet({ path: 'snippets/example.ts', code: 'const value = ;' });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual([expect.stringContaining('Expression expected')]);
  });

  it('skips Python snippet checks when pyright is unavailable', async () => {
    await expect(
      checkPythonSnippet({
        path: 'snippets/example.py',
        code: 'value: int = 1',
        pyrightCommand: 'definitely-not-pyright'
      })
    ).resolves.toEqual({ checkId: pythonSnippetCheckId, status: 'skipped', reason: 'pyright is unavailable' });
  });

  it('checks relative import paths', () => {
    expect(
      checkImportPaths({
        files: ['src/main.ts', 'src/helper.ts'],
        imports: [{ fromPath: 'src/main.ts', specifier: './helper' }]
      })
    ).toEqual({ checkId: importPathCheckId, status: 'passed' });

    const failed = checkImportPaths({
      files: ['src/main.ts'],
      imports: [{ fromPath: 'src/main.ts', specifier: './missing' }]
    });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual(['Unresolved relative import: ./missing']);
  });

  it('checks internal and external links', async () => {
    await expect(
      checkLinks({
        sourcePath: 'docs/overview.mdx',
        files: ['docs/overview.mdx', 'docs/install.mdx'],
        anchors: ['docs/install.mdx#quick-start'],
        links: ['docs/install.mdx#quick-start', 'https://docstube.dev'],
        fetchExternal: () => true
      })
    ).resolves.toEqual({ checkId: linkCheckId, status: 'passed' });

    const failed = await checkLinks({
      sourcePath: 'docs/overview.mdx',
      files: ['docs/overview.mdx'],
      anchors: [],
      links: ['docs/missing.mdx', 'https://bad.example'],
      fetchExternal: () => false
    });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual(
      expect.arrayContaining([
        'Internal link target is missing: docs/missing.mdx',
        'External link did not resolve: https://bad.example'
      ])
    );
  });

  it('skips external link checks when no fetcher is available', async () => {
    await expect(checkLinks({ files: ['docs/overview.mdx'], links: ['https://docstube.dev'] })).resolves.toEqual({
      checkId: linkCheckId,
      status: 'skipped',
      reason: 'external link fetcher is unavailable'
    });
  });

  it('checks D2 diagrams', async () => {
    await expect(checkD2({ path: 'docs/diagram.d2', source: 'a -> b' })).resolves.toEqual({
      checkId: d2CheckId,
      status: 'passed'
    });

    const failed = await checkD2({ path: 'docs/diagram.d2', source: 'a ->' });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed).length).toBeGreaterThan(0);
  });

  it('checks glossary definitions and used terms', () => {
    expect(checkGlossaryRules({ glossary: validGlossary, usedTerms: ['Codemap'] })).toEqual({
      checkId: glossaryRulesCheckId,
      status: 'passed'
    });

    const failed = checkGlossaryRules({
      glossary: {
        terms: [
          { id: 'codemap', term: 'Codemap', definition: 'A structural map.' },
          { id: 'map', term: 'Map', definition: 'A diagram.', aliases: ['Codemap'] }
        ]
      },
      usedTerms: ['Pipeline']
    });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual(
      expect.arrayContaining([
        'Glossary label is used by multiple terms: Codemap',
        'Glossary term is not defined: Pipeline'
      ])
    );
  });

  it('checks API references against extractor output', () => {
    const extracted = [
      {
        id: 'typedoc:src/toolkit.ts:add',
        name: 'add',
        kind: 'function',
        sourcePath: 'src/toolkit.ts',
        line: 1,
        extractor: 'typedoc',
        source: 'typedoc'
      }
    ] as const;

    expect(checkApiReferenceConsistency({ documentedSymbols: ['add'], extractedSymbols: [...extracted] })).toEqual({
      checkId: apiReferenceConsistencyCheckId,
      status: 'passed'
    });

    const failed = checkApiReferenceConsistency({ documentedSymbols: ['missing'], extractedSymbols: [...extracted] });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual(['Documented API symbol is missing from extractor output: missing']);
  });
});

describe('foundational deterministic verifiers', () => {
  it('checks the config family against frozen schemas', () => {
    expect(checkConfigFamily({ docstubeConfig: validConfig, ia: validIa, glossary: validGlossary })).toEqual({
      checkId: configFamilyCheckId,
      status: 'passed'
    });

    const failed = checkConfigFamily({
      docstubeConfig: { ...validConfig, personas: [] },
      ia: { nav: [] },
      glossary: { terms: [{ id: 'codemap', term: 'Codemap' }] }
    });

    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('personas'),
        expect.stringContaining('nav'),
        expect.stringContaining('definition')
      ])
    );
  });

  it('checks generated page frontmatter', () => {
    expect(checkGeneratedPageFrontmatter({ path: page.path, frontmatter: page.frontmatter })).toEqual({
      checkId: generatedFrontmatterCheckId,
      status: 'passed'
    });

    const failed = checkGeneratedPageFrontmatter({
      path: page.path,
      frontmatter: { ...page.frontmatter, title: '', id: 'Overview' }
    });

    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' ? failed.findings.map((finding) => finding.location?.path) : []).toEqual([
      page.path,
      page.path
    ]);
  });

  it('checks page and section IDs plus duplicate detection', () => {
    expect(checkPageAndSectionIds({ pageIds: ['overview', 'guides/install'], sectionsByPage: [] })).toEqual({
      checkId: pageSectionIdCheckId,
      status: 'passed'
    });

    const failed = checkPageAndSectionIds({
      pageIds: ['overview', 'overview', 'Bad'],
      sectionsByPage: [{ pageId: 'overview', sectionIds: ['intro', 'intro', 'Bad'] }]
    });

    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' ? failed.findings.map((finding) => finding.message) : []).toEqual(
      expect.arrayContaining(['Duplicate page id: overview', 'Duplicate section id: intro'])
    );
  });

  it('passes when declared sections have balanced markers', () => {
    expect(checkGeneratedPageSections(page)).toEqual({ checkId: generatedPageSectionCheckId, status: 'passed' });
  });

  it('returns structured findings for section marker drift', () => {
    const result = checkGeneratedPageSections({
      ...page,
      body: [buildSectionMarker('start', 'other'), '## Other', buildSectionMarker('end', 'other')].join('\n')
    });

    expect(result.status).toBe('failed');
    expect(failedSectionIds(result)).toEqual(['intro', 'other']);
  });

  it('compiles MDX body to static HTML', async () => {
    await expect(compileGeneratedMdxPageToHtml(page)).resolves.toContain('DOCSTUBE_S0_WALKING_SKELETON_TOKEN');
  });

  it('checks MDX compilation as a deterministic result', async () => {
    await expect(checkMdxCompiles({ path: page.path, body: page.body })).resolves.toEqual({
      checkId: mdxCompileCheckId,
      status: 'passed'
    });

    const failed = await checkMdxCompiles({ path: page.path, body: '<Broken' });
    expect(failed.status).toBe('failed');
    expect(findingMessages(failed)).toEqual([expect.stringContaining('Unexpected')]);
  });

  it('validates component props through registry metadata', () => {
    const registry: ComponentRegistry = {
      version: 1,
      components: [{ name: 'Callout', status: 'stable', props: { ref: 'callout-props' } }]
    };
    const propSchemas = {
      'callout-props': z.strictObject({ tone: z.enum(['info', 'warning']) })
    };

    expect(
      checkComponentProps({
        registry,
        propSchemas,
        usages: [{ name: 'Callout', props: { tone: 'info' }, location: { path: page.path } }]
      })
    ).toEqual({ checkId: componentPropsCheckId, status: 'passed' });

    const failed = checkComponentProps({
      registry,
      propSchemas,
      usages: [
        { name: 'Callout', props: { tone: 'danger' }, location: { path: page.path } },
        { name: 'Unknown', props: {}, location: { path: page.path } }
      ]
    });

    expect(failed.status).toBe('failed');
    expect(failed.status === 'failed' ? failed.findings.map((finding) => finding.message) : []).toEqual(
      expect.arrayContaining([expect.stringContaining('tone'), 'Component is not registered: Unknown'])
    );
  });
});
