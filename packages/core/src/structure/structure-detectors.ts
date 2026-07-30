import type { StructuralFinding, StructuralSnapshot, StructuralSnapshotPage } from '@docstube/contracts';
import { contentHashSchema, hashValue, structuralFindingSchema } from '@docstube/contracts';
import { normalizeFacet, sectionHasBody } from './structural-snapshot.ts';

// DETERMINISTIC DETECTORS — the ones that emit findings DIRECTLY, with no model call
// (quality-ci-reader-v2 decision 20). Two families:
//
//   outline integrity   an intrinsic defect on one page: a heading with nothing under it, the same
//                       heading twice. Authority 'builtin-rule' — the tool asserts the rule.
//   explicit ia rules   a `consistency.rules` entry the user WROTE in ia.yml. Authority
//                       'explicit-ia-rule' — the user asserted the rule, so there is nothing to
//                       adjudicate and the finding is deterministic (decision 19's ladder).
//
// Nothing here is a candidate: a candidate is an INFERRED convention, which requires per-page AI
// applicability adjudication before it may become a finding. That path lives in facet-matrix.ts.

export const structuralDetectorVersion = '1';

const deterministicDetector = (id: string) =>
  ({ kind: 'deterministic', id, version: structuralDetectorVersion }) as const;

// The scope fingerprint drives auto-resolve and suppression reopening: it must move when the
// scoped CONTENT materially changes and stay put otherwise.
const pageScopeFingerprint = (page: StructuralSnapshotPage): string =>
  contentHashSchema.parse(hashValue({ outline: page.outline, exceptions: page.structuralExceptions }));

export const structuralFindingKey = (parts: readonly string[]): string => parts.join(':');

// A heading that promises content and delivers none. The reader-visible failure the founder named
// as a page failure mode — and one no model is needed to see.
const emptySectionFindings = (page: StructuralSnapshotPage): StructuralFinding[] =>
  page.outline
    .filter((entry) => !sectionHasBody(entry))
    .map((entry) =>
      structuralFindingSchema.parse({
        schemaVersion: 1,
        key: structuralFindingKey([
          'structure.empty-section',
          page.pageId,
          entry.sectionId ?? normalizeFacet(entry.title)
        ]),
        code: 'structure.empty-section',
        scope: {
          kind: 'entity',
          pageId: page.pageId,
          ...(entry.sectionId === undefined ? {} : { entityId: entry.sectionId })
        },
        detector: deterministicDetector('outline-integrity'),
        authority: { kind: 'builtin-rule', ruleCode: 'outline-integrity.empty-section' },
        impact: 'medium',
        status: { state: 'open' },
        evidence: [
          {
            pageId: page.pageId,
            ...(entry.sectionId === undefined ? {} : { entityId: entry.sectionId }),
            detail: `The "${entry.title}" heading (level ${entry.level}) has no body content under it.`
          }
        ],
        repairTargets: [page.pageId],
        message: `"${entry.title}" is an empty section — the heading promises content the page does not deliver.`,
        scopeFingerprint: pageScopeFingerprint(page)
      })
    );

// Two headings that normalize to the SAME facet on one page. This is the deterministic floor of
// "two sections talking about the same thing": identical headings need no judgment. The SEMANTIC
// case (two differently-titled sections covering the same ground) is deliberately not here — it is
// AI-adjudicated within-page work and belongs to the risk critic (decision 18).
const duplicateHeadingFindings = (page: StructuralSnapshotPage): StructuralFinding[] => {
  const byFacet = new Map<string, typeof page.outline>();
  for (const entry of page.outline) {
    const facet = normalizeFacet(entry.title);
    if (facet === '') {
      continue;
    }
    byFacet.set(facet, [...(byFacet.get(facet) ?? []), entry]);
  }
  return [...byFacet.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([facet, entries]) =>
      structuralFindingSchema.parse({
        schemaVersion: 1,
        key: structuralFindingKey(['structure.duplicate-heading', page.pageId, facet]),
        code: 'structure.duplicate-heading',
        scope: { kind: 'entity', pageId: page.pageId },
        detector: deterministicDetector('outline-integrity'),
        authority: { kind: 'builtin-rule', ruleCode: 'outline-integrity.duplicate-heading' },
        impact: 'medium',
        status: { state: 'open' },
        evidence: entries.map((entry) => ({
          pageId: page.pageId,
          ...(entry.sectionId === undefined ? {} : { entityId: entry.sectionId }),
          detail: `"${entry.title}" (level ${entry.level})`
        })),
        repairTargets: [page.pageId],
        message: `${entries.length} sections on this page share the heading "${entries[0]?.title ?? facet}" — the same ground is covered twice.`,
        scopeFingerprint: pageScopeFingerprint(page)
      })
    );
};

export const runOutlineIntegrityDetectors = (page: StructuralSnapshotPage): StructuralFinding[] => [
  ...emptySectionFindings(page),
  ...duplicateHeadingFindings(page)
];

const requiredFacetsOf = (parameters: Record<string, unknown> | undefined): string[] => {
  const facets = parameters?.['facets'];
  return Array.isArray(facets) ? facets.filter((facet): facet is string => typeof facet === 'string') : [];
};

// `required-facets` — the one built-in consistency rule in 0.1.0 (ia-v2-schema). The user declared
// that every page in this group carries these sections, so a missing one is a finding with no
// model in the loop. `structuralExceptions` on a page is the user's own opt-out and is honored
// verbatim: ia.yml holds intent, and intent wins over the rule it qualifies.
export const runExplicitConsistencyRules = (snapshot: StructuralSnapshot): StructuralFinding[] => {
  const pagesById = new Map(snapshot.pages.map((page) => [page.pageId, page]));
  const findings: StructuralFinding[] = [];
  for (const group of snapshot.groups) {
    if (group.consistencyMode !== 'explicit') {
      continue;
    }
    const members = group.pageIds.flatMap((pageId) => {
      const page = pagesById.get(pageId);
      return page === undefined ? [] : [page];
    });
    if (members.length === 0) {
      continue;
    }
    for (const rule of group.consistencyRules) {
      if (rule.code !== 'required-facets') {
        // An unknown rule code is not silently ignored by the pass — the caller reports it — but it
        // is never guessed at either.
        continue;
      }
      for (const declared of requiredFacetsOf(rule.parameters)) {
        const facet = normalizeFacet(declared);
        if (facet === '') {
          continue;
        }
        const missing = members.filter(
          (page) =>
            !page.outline.some((entry) => normalizeFacet(entry.title) === facet) &&
            !page.structuralExceptions.some((exception) => normalizeFacet(exception) === facet)
        );
        if (missing.length === 0) {
          continue;
        }
        findings.push(
          structuralFindingSchema.parse({
            schemaVersion: 1,
            key: structuralFindingKey(['structure.required-facet-missing', group.groupId, facet]),
            code: 'structure.required-facet-missing',
            scope: { kind: 'nav-group', groupId: group.groupId, pageIds: members.map((page) => page.pageId) },
            detector: deterministicDetector('required-facets'),
            authority: { kind: 'explicit-ia-rule', ruleCode: 'required-facets' },
            // The user wrote the rule down; a violation is the highest-confidence structural defect
            // this pass can produce. It is still NONBLOCKING (decision 21, the founder's call).
            impact: 'high',
            status: { state: 'open' },
            evidence: missing.map((page) => ({
              pageId: page.pageId,
              detail: `no "${declared}" section`
            })),
            repairTargets: missing.map((page) => page.pageId),
            message: `${missing.length} of ${members.length} pages in "${group.title ?? group.groupId}" are missing the required "${declared}" section.`,
            scopeFingerprint: groupScopeFingerprint(members)
          })
        );
      }
    }
  }
  return findings;
};

// A group's fingerprint is its members' outline hashes — prose edits inside a section must not
// reopen a suppressed group finding, but adding or removing a section must.
export const groupScopeFingerprint = (members: readonly StructuralSnapshotPage[]): string =>
  contentHashSchema.parse(
    hashValue(
      members
        .map((page) => ({ pageId: page.pageId, outlineHash: page.outlineHash, exceptions: page.structuralExceptions }))
        .toSorted((left, right) => left.pageId.localeCompare(right.pageId))
    )
  );
