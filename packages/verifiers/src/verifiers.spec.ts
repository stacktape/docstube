import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSectionMarker } from '@docstube/contracts';
import type { ComponentRegistry } from '@docstube/contracts';
import {
  checkComponentProps,
  checkConfigFamily,
  checkGeneratedPageFrontmatter,
  checkGeneratedPageSections,
  checkMdxCompiles,
  checkPageAndSectionIds,
  compileGeneratedMdxPageToHtml,
  componentPropsCheckId,
  configFamilyCheckId,
  foundationalVerifierRegistry,
  generatedFrontmatterCheckId,
  generatedPageSectionCheckId,
  mdxCompileCheckId,
  pageSectionIdCheckId
} from './verifiers';
import type { GeneratedMdxPage } from './verifiers';

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

const findingMessages = (result: Awaited<ReturnType<typeof checkMdxCompiles>> | ReturnType<typeof checkConfigFamily>) =>
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
