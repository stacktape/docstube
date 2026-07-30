import { describe, expect, it } from 'vitest';
import { structuralSnapshotSchema } from '@docstube/contracts';
import { runExplicitConsistencyRules, runOutlineIntegrityDetectors } from './structure-detectors.ts';
import { buildSnapshotPage } from './structure-test-support.ts';

describe('outline integrity detectors', () => {
  it('flags a heading with no body under it', () => {
    const page = buildSnapshotPage({
      slug: 'containers',
      sections: ['Overview', 'Pricing'],
      emptySections: ['Pricing']
    });
    const findings = runOutlineIntegrityDetectors(page);
    expect(findings.map((finding) => finding.code)).toEqual(['structure.empty-section']);
    expect(findings[0]?.message).toContain('"Pricing" is an empty section');
    // Deterministic all the way down: no model, no cohort, no inference.
    expect(findings[0]?.detector).toEqual({ kind: 'deterministic', id: 'outline-integrity', version: '1' });
    expect(findings[0]?.authority).toEqual({ kind: 'builtin-rule', ruleCode: 'outline-integrity.empty-section' });
    expect(findings[0]?.repairTargets).toEqual([page.pageId]);
  });

  it('flags the same heading twice on one page, normalizing case and punctuation', () => {
    const page = buildSnapshotPage({ slug: 'containers', sections: ['Pricing', 'Overview', 'pricing!'] });
    const findings = runOutlineIntegrityDetectors(page).filter(
      (finding) => finding.code === 'structure.duplicate-heading'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.key).toContain(':pricing');
  });

  it('raises nothing on a clean page', () => {
    expect(
      runOutlineIntegrityDetectors(buildSnapshotPage({ slug: 'containers', sections: ['Overview', 'Pricing'] }))
    ).toEqual([]);
  });

  it('gives the same defect the same key across runs — one record, never a pile of duplicates', () => {
    const page = buildSnapshotPage({ slug: 'containers', sections: ['Overview'], emptySections: ['Overview'] });
    const first = runOutlineIntegrityDetectors(page);
    const second = runOutlineIntegrityDetectors(page);
    expect(first[0]?.key).toBe(second[0]?.key);
    expect(first[0]?.scopeFingerprint).toBe(second[0]?.scopeFingerprint);
  });
});

const snapshotWith = (input: {
  mode: 'off' | 'inferred' | 'explicit';
  rules: Array<{ code: string; parameters?: Record<string, unknown> }>;
  pages: ReturnType<typeof buildSnapshotPage>[];
}) =>
  structuralSnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: '2026-07-12T00:00:00.000Z',
    groups: [
      {
        groupId: 'compute-resources',
        title: 'Compute resources',
        pageIds: input.pages.map((page) => page.pageId),
        consistencyMode: input.mode,
        consistencyRules: input.rules
      }
    ],
    pages: input.pages
  });

describe('explicit ia consistency rules', () => {
  const withPricing = buildSnapshotPage({ slug: 'containers', sections: ['Overview', 'Pricing'] });
  const withoutPricing = buildSnapshotPage({ slug: 'batch-jobs', sections: ['Overview'] });

  it('is a deterministic finding when the user wrote the rule down', () => {
    const findings = runExplicitConsistencyRules(
      snapshotWith({
        mode: 'explicit',
        rules: [{ code: 'required-facets', parameters: { facets: ['Pricing'] } }],
        pages: [withPricing, withoutPricing]
      })
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('structure.required-facet-missing');
    expect(findings[0]?.detector.kind).toBe('deterministic');
    expect(findings[0]?.authority).toEqual({ kind: 'explicit-ia-rule', ruleCode: 'required-facets' });
    expect(findings[0]?.repairTargets).toEqual([withoutPricing.pageId]);
    // Nonblocking even at high impact — the founder's call (decision 21).
    expect(findings[0]?.impact).toBe('high');
  });

  it('honors a page-level structural exception — ia.yml intent wins over the rule it qualifies', () => {
    const exempt = buildSnapshotPage({
      slug: 'batch-jobs',
      sections: ['Overview'],
      structuralExceptions: ['pricing']
    });
    expect(
      runExplicitConsistencyRules(
        snapshotWith({
          mode: 'explicit',
          rules: [{ code: 'required-facets', parameters: { facets: ['Pricing'] } }],
          pages: [withPricing, exempt]
        })
      )
    ).toEqual([]);
  });

  it('never fires on a group whose consistency mode is inferred or off', () => {
    for (const mode of ['inferred', 'off'] as const) {
      expect(
        runExplicitConsistencyRules(
          snapshotWith({
            mode,
            rules: [{ code: 'required-facets', parameters: { facets: ['Pricing'] } }],
            pages: [withPricing, withoutPricing]
          })
        )
      ).toEqual([]);
    }
  });

  it('ignores unknown rule codes instead of guessing at them', () => {
    expect(
      runExplicitConsistencyRules(
        snapshotWith({
          mode: 'explicit',
          rules: [{ code: 'prerequisite-flow', parameters: { facets: ['Pricing'] } }],
          pages: [withPricing, withoutPricing]
        })
      )
    ).toEqual([]);
  });
});
