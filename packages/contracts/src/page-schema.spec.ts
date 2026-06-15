import { describe, expect, it } from 'vitest';
import {
  checkSectionPresence,
  duplicatePageIds,
  duplicateSectionIds,
  generatedPageFrontmatterSchema,
  pageIdSchema,
  sectionIdSchema
} from './page-schema';
import { buildSectionMarker, extractSectionMarkers, parseSectionMarker } from './section-markers';

describe('pageIdSchema', () => {
  it('accepts single and nested kebab segments', () => {
    expect(pageIdSchema.parse('overview')).toBe('overview');
    expect(pageIdSchema.parse('guides/install')).toBe('guides/install');
  });

  it('rejects uppercase, leading/trailing slash, and underscores', () => {
    for (const bad of ['Overview', '/overview', 'guides/', 'getting_started', '']) {
      expect(pageIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('sectionIdSchema', () => {
  it('accepts a single kebab segment', () => {
    expect(sectionIdSchema.parse('quick-start')).toBe('quick-start');
  });

  it('rejects nested segments', () => {
    expect(sectionIdSchema.safeParse('guides/install').success).toBe(false);
  });
});

describe('page and section uniqueness', () => {
  it('reports duplicate page ids', () => {
    expect(duplicatePageIds(['overview', 'guides/install', 'overview'])).toEqual(['overview']);
  });

  it('returns no duplicates when page ids are unique', () => {
    expect(duplicatePageIds(['overview', 'guides/install'])).toEqual([]);
  });

  it('reports duplicate section ids within a page', () => {
    expect(duplicateSectionIds(['intro', 'usage', 'intro'])).toEqual(['intro']);
  });
});

describe('section marker convention', () => {
  it('builds round-trippable markers', () => {
    const marker = buildSectionMarker('start', 'quick-start');
    expect(marker).toBe('{/* docstube:section:start id=quick-start */}');
    expect(parseSectionMarker(marker)).toEqual({ kind: 'start', sectionId: 'quick-start' });
  });

  it('ignores non-marker lines', () => {
    expect(parseSectionMarker('# Heading')).toBeNull();
  });

  it('extracts markers in document order', () => {
    const mdx = [
      buildSectionMarker('start', 'intro'),
      'Welcome.',
      buildSectionMarker('end', 'intro'),
      buildSectionMarker('start', 'usage'),
      buildSectionMarker('end', 'usage')
    ].join('\n');

    expect(extractSectionMarkers(mdx)).toEqual([
      { kind: 'start', sectionId: 'intro' },
      { kind: 'end', sectionId: 'intro' },
      { kind: 'start', sectionId: 'usage' },
      { kind: 'end', sectionId: 'usage' }
    ]);
  });
});

describe('checkSectionPresence', () => {
  const body = [
    buildSectionMarker('start', 'intro'),
    'Welcome.',
    buildSectionMarker('end', 'intro'),
    buildSectionMarker('start', 'usage'),
    buildSectionMarker('end', 'usage')
  ].join('\n');

  it('passes when declared sections match balanced markers', () => {
    expect(checkSectionPresence(['intro', 'usage'], body)).toEqual({
      missing: [],
      undeclared: [],
      unbalanced: []
    });
  });

  it('flags a declared section with no marker pair as missing', () => {
    const result = checkSectionPresence(['intro', 'usage', 'faq'], body);
    expect(result.missing).toEqual(['faq']);
    expect(result.undeclared).toEqual([]);
  });

  it('flags a marker pair that is not declared as undeclared', () => {
    const result = checkSectionPresence(['intro'], body);
    expect(result.undeclared).toEqual(['usage']);
  });

  it('flags an unbalanced marker pair', () => {
    const unbalanced = [buildSectionMarker('start', 'intro'), 'No end marker.'].join('\n');
    const result = checkSectionPresence(['intro'], unbalanced);
    expect(result.unbalanced).toEqual(['intro']);
    expect(result.missing).toEqual(['intro']);
  });

  it('flags markers whose end appears before start', () => {
    const reversed = [buildSectionMarker('end', 'intro'), buildSectionMarker('start', 'intro')].join('\n');
    const result = checkSectionPresence(['intro'], reversed);
    expect(result.unbalanced).toEqual(['intro']);
    expect(result.missing).toEqual(['intro']);
  });
});

describe('generatedPageFrontmatterSchema', () => {
  it('requires the generated stamp', () => {
    const result = generatedPageFrontmatterSchema.safeParse({ id: 'overview', title: 'Overview' });
    expect(result.success).toBe(false);
  });

  it('accepts a fully populated frontmatter', () => {
    const parsed = generatedPageFrontmatterSchema.parse({
      id: 'guides/install',
      title: 'Install',
      sections: ['requirements', 'quick-start'],
      generated: { by: 'docstube', version: '0.0.2', at: '2026-06-16T12:00:00Z' }
    });
    expect(parsed.sections).toEqual(['requirements', 'quick-start']);
  });
});
