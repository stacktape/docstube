import { describe, expect, it } from 'vitest';
import { buildSectionMarker } from '@docstube/contracts';
import { checkGeneratedPageSections, compileGeneratedMdxPageToHtml, generatedPageSectionCheckId } from './verifiers';
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

describe('deterministic page verifiers', () => {
  it('passes when declared sections have balanced markers', () => {
    expect(checkGeneratedPageSections(page)).toEqual({ checkId: generatedPageSectionCheckId, status: 'passed' });
  });

  it('returns structured findings for section marker drift', () => {
    const result = checkGeneratedPageSections({
      ...page,
      body: [buildSectionMarker('start', 'other'), '## Other', buildSectionMarker('end', 'other')].join('\n')
    });

    expect(result.status).toBe('failed');
    expect('findings' in result ? result.findings.map((finding) => finding.sectionId).toSorted() : []).toEqual([
      'intro',
      'other'
    ]);
  });

  it('compiles MDX body to static HTML', async () => {
    await expect(compileGeneratedMdxPageToHtml(page)).resolves.toContain('DOCSTUBE_S0_WALKING_SKELETON_TOKEN');
  });
});
