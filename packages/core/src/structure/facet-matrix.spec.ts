import { describe, expect, it } from 'vitest';
import { structuralSnapshotSchema } from '@docstube/contracts';
import type { StructuralSnapshotPage } from '@docstube/contracts';
import { siblingFacetCandidates } from './facet-matrix.ts';
import { buildSnapshotPage } from './structure-test-support.ts';

const groupSnapshot = (pages: StructuralSnapshotPage[], mode: 'off' | 'inferred' | 'explicit' = 'inferred') =>
  structuralSnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: '2026-07-12T00:00:00.000Z',
    groups: [
      {
        groupId: 'compute-resources',
        title: 'Compute resources',
        pageIds: pages.map((page) => page.pageId),
        consistencyMode: mode
      }
    ],
    pages
  });

const resourcePage = (slug: string, sections: string[], extra: Partial<Parameters<typeof buildSnapshotPage>[0]> = {}) =>
  buildSnapshotPage({ slug, sections, groupId: 'compute-resources', ...extra });

describe('sibling shared-facet asymmetry — the outline matrix', () => {
  it('summons a candidate when a facet crosses 60% of a cohort of at least 4', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview', 'Pricing']),
      resourcePage('workers', ['Overview'])
    ];
    const candidates = siblingFacetCandidates(groupSnapshot(pages)).filter((entry) => entry.facet === 'pricing');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.cohortSize).toBe(4);
    expect(candidates[0]?.prevalence).toBeCloseTo(0.75);
    expect(candidates[0]?.missing.map((page) => page.pageId)).toEqual([pages[3]?.pageId]);
  });

  it('refuses a cohort below 4 — the binding 0.1.0 rule', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('workers', ['Overview'])
    ];
    expect(siblingFacetCandidates(groupSnapshot(pages)).filter((entry) => entry.facet === 'pricing')).toEqual([]);
  });

  it('refuses a facet below 60% prevalence', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview']),
      resourcePage('workers', ['Overview'])
    ];
    expect(siblingFacetCandidates(groupSnapshot(pages)).filter((entry) => entry.facet === 'pricing')).toEqual([]);
  });

  it('does not infer across mixed page roles or mixed structure profiles', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview', 'Pricing']),
      // A tutorial that happens to sit in the same nav group is not a sibling.
      resourcePage('getting-started', ['Overview'], { primaryPersona: 'newcomer' })
    ];
    expect(siblingFacetCandidates(groupSnapshot(pages)).filter((entry) => entry.facet === 'pricing')).toEqual([]);
  });

  it('removes an exempt page from BOTH sides of the ratio', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview', 'Pricing']),
      resourcePage('workers', ['Overview'], { structuralExceptions: ['Pricing'] })
    ];
    // The only page lacking the facet is exempt, so the remaining cohort is 3 — below the floor.
    expect(siblingFacetCandidates(groupSnapshot(pages)).filter((entry) => entry.facet === 'pricing')).toEqual([]);
  });

  it('respects the group consistency mode', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview', 'Pricing']),
      resourcePage('workers', ['Overview'])
    ];
    expect(siblingFacetCandidates(groupSnapshot(pages, 'off'))).toEqual([]);
    // 'explicit' means the user enumerated the rules; inferring further conventions would
    // second-guess a decision already made.
    expect(siblingFacetCandidates(groupSnapshot(pages, 'explicit'))).toEqual([]);
  });

  it('is a trigger, not a verdict: crossing the threshold emits no finding by itself', () => {
    const pages = [
      resourcePage('containers', ['Overview', 'Pricing']),
      resourcePage('functions', ['Overview', 'Pricing']),
      resourcePage('batch-jobs', ['Overview', 'Pricing']),
      resourcePage('workers', ['Overview'])
    ];
    const candidates = siblingFacetCandidates(groupSnapshot(pages));
    // The matrix produces CANDIDATES. Nothing here has a key, a status, or a repair target — those
    // only exist once the group assessor has adjudicated applicability per page.
    expect(candidates.every((candidate) => !('key' in candidate))).toBe(true);
  });
});
