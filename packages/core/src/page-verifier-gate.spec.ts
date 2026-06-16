import { buildSectionMarker } from '@docstube/contracts';
import {
  apiReferenceConsistencyCheckId,
  checkGeneratedPageSections,
  componentPropsCheckId,
  generatedPageSectionCheckId
} from '@docstube/verifiers';
import { describe, expect, it } from 'vitest';
import type { GeneratedMdxPage } from '@docstube/verifiers';
import type { PageGenerationContext } from './page-generation-context.ts';
import { createProjectPageVerifiers, extractMdxComponentUsages } from './page-verifier-gate.ts';

const timestamp = '2026-06-16T00:00:00.000Z';

const context: PageGenerationContext = {
  apiSymbols: [
    {
      id: 'typedoc:src/toolkit.ts:add',
      name: 'add',
      kind: 'function',
      sourcePath: 'src/toolkit.ts',
      line: 1,
      extractor: 'typedoc',
      source: 'mock'
    }
  ],
  componentNames: ['ApiReference', 'Callout', 'Term'],
  criteria: ['The page must explain successful usage.'],
  glossaryTerms: [{ id: 'codemap', term: 'Codemap', definition: 'A source map for documentation.', aliases: [] }],
  instructions: ['Prefer concrete source paths over generic phrasing.'],
  provenance: {
    reads: ['src/toolkit.ts'],
    citations: [{ path: 'src/toolkit.ts', symbol: 'add' }]
  },
  sourceDigests: [{ algorithm: 'sha256', path: 'src/toolkit.ts', value: 'a'.repeat(64) }],
  sourceFacts: ['src/toolkit.ts [typescript, aaaaaaaaaaaa]: add (function, lines 1-3)'],
  sources: [
    {
      path: 'src/toolkit.ts',
      hash: 'a'.repeat(64),
      language: 'typescript',
      symbols: [{ name: 'add', kind: 'function', startLine: 1, endLine: 3 }]
    }
  ]
};

const page = (body: string): GeneratedMdxPage => ({
  path: 'docs/src/pages/index.mdx',
  frontmatter: {
    id: 'overview',
    title: 'Overview',
    sections: ['intro'],
    generated: { by: 'docstube', version: '0.0.2', at: timestamp }
  },
  body
});

describe('project page verifier gate', () => {
  it('runs the foundational checks plus optional content gates from one page context', async () => {
    const generatedPage = page(
      [
        buildSectionMarker('start', 'intro'),
        '',
        '## Overview',
        '',
        'Use source-backed prose.',
        '',
        buildSectionMarker('end', 'intro')
      ].join('\n')
    );
    const results = await Promise.all(
      createProjectPageVerifiers({ context, knownFiles: ['docs/src/pages/index.mdx', 'src/toolkit.ts'] }).map(
        (verifier) => verifier.run(generatedPage)
      )
    );

    expect(results.find((result) => result.checkId === generatedPageSectionCheckId)).toEqual(
      checkGeneratedPageSections(generatedPage)
    );
    expect(results.find((result) => result.checkId === componentPropsCheckId)).toEqual({
      checkId: componentPropsCheckId,
      status: 'passed'
    });
  });

  it('extracts component usages and checks documented API symbols against source context', async () => {
    expect(extractMdxComponentUsages(page('<Callout tone="warning" title="Read first" />'))).toEqual([
      {
        name: 'Callout',
        props: { tone: 'warning', title: 'Read first' },
        location: { path: 'docs/src/pages/index.mdx', line: 1 }
      }
    ]);

    const apiVerifier = createProjectPageVerifiers({
      context,
      knownFiles: ['docs/src/pages/index.mdx', 'src/toolkit.ts']
    }).find((verifier) => verifier.id === apiReferenceConsistencyCheckId);

    expect(apiVerifier).toBeDefined();
    if (!apiVerifier) {
      throw new Error('api verifier missing from project gate');
    }

    expect(await apiVerifier.run(page('<ApiReference symbol="missing" />'))).toMatchObject({
      checkId: apiReferenceConsistencyCheckId,
      status: 'failed'
    });
  });
});
