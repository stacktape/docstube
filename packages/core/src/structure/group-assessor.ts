import { z } from 'zod';
import type { AgentTaskSpec, StructuralFinding, StructuralSnapshotPage, Transcript } from '@docstube/contracts';
import {
  agentTaskSpecSchema,
  contentHashSchema,
  hashValue,
  idPrefixes,
  mintId,
  pageIdSchema,
  structuralFindingSchema
} from '@docstube/contracts';
import type { FacetCandidate } from './facet-matrix.ts';
import { structuralDetectorVersion, structuralFindingKey } from './structure-detectors.ts';

// THE GROUP ASSESSOR (quality-ci-reader-v2 decision 20) — the only AI in the structure pass, and
// the only thing entitled to turn a matrix candidate into a finding.
//
// It is asked ONE question per candidate: for each sibling that lacks this facet, is the facet
// EXPECTED here, NOT-APPLICABLE here, or is the answer UNCERTAIN? It answers from the briefs, the
// primary personas, the page plans and the claim subjects — the evidence for what each page is
// actually about. The prevalence number that summoned it is stated as a trigger, never as a
// conclusion, because a model told "5 of 8 siblings have this" will otherwise dutifully confirm
// that the other 3 are broken.
//
// `uncertain` produces NO finding. That is the whole conservatism of the feature: docstube would
// rather say nothing than tell a user their page is inconsistent because a model could not decide.

export const groupAssessorPromptVersion = '1';
export const groupAssessorDetectorId = 'sibling-facet-asymmetry';

export const structuralAssessmentOutcomes = ['expected', 'not-applicable', 'uncertain'] as const;

export const groupAssessmentResultSchema = z.object({
  assessments: z
    .array(
      z.object({
        pageId: pageIdSchema,
        outcome: z.enum(structuralAssessmentOutcomes),
        // Grounded in the page's own brief/plan/subjects — the reason a human can check.
        reasoning: z.string().min(1)
      })
    )
    .default([])
});
export type GroupAssessmentResult = z.infer<typeof groupAssessmentResultSchema>;

const pageDigest = (page: StructuralSnapshotPage, hasFacet: boolean): string =>
  [
    `- pageId: ${page.pageId}${hasFacet ? ' (HAS the section)' : ' (LACKS the section)'}`,
    `  brief: ${page.brief}`,
    `  primary persona: ${page.primaryPersona}`,
    ...(page.structureProfile === undefined ? [] : [`  structure profile: ${page.structureProfile}`]),
    ...(page.plan === undefined ? [] : [`  page plan: ${page.plan}`]),
    `  outline: ${page.outline.length === 0 ? '(no sections)' : page.outline.map((entry) => entry.title).join(' · ')}`,
    ...(page.claimSubjects.length === 0 ? [] : [`  documented subjects: ${page.claimSubjects.slice(0, 12).join(', ')}`])
  ].join('\n');

export const buildAssessGroupStructureTask = (candidate: FacetCandidate): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'assess-group-structure',
    systemPrompt: [
      'You judge documentation STRUCTURE, not documentation correctness. You are given a group of',
      'sibling documentation pages and one section ("facet") that most of them have and some do not.',
      '',
      'For EACH page that lacks the section, decide exactly one outcome:',
      '- "expected" — this page is the same kind of thing as its siblings and a reader would',
      '  reasonably expect this section here. Its absence is an inconsistency worth fixing.',
      '- "not-applicable" — the section genuinely does not apply to this page (the subject it',
      '  documents has no such aspect, or the page plays a different role from its siblings).',
      '- "uncertain" — the evidence given does not settle it.',
      '',
      'RULES:',
      '- The prevalence figure is only why you were asked; it is NOT evidence that the missing pages',
      '  are wrong. A section most siblings share can still be irrelevant to one of them.',
      "- Decide from each page's own brief, plan, persona and documented subjects. If those do not",
      '  settle it, answer "uncertain". "uncertain" is a correct, expected answer — never guess.',
      '- Judge only the pages listed as LACKING the section. Ignore the others.',
      "- Every reasoning must cite something concrete from that page's brief, plan or subjects."
    ].join('\n'),
    userPrompt: [
      `Navigation group: ${candidate.groupTitle ?? candidate.groupId}`,
      `Shared section under review: "${candidate.facetTitle}"`,
      `Trigger: ${candidate.present.length} of ${candidate.cohortSize} comparable sibling pages have it.`,
      '',
      'Sibling pages:',
      ...candidate.cohort.map((page) =>
        pageDigest(
          page,
          candidate.present.some((entry) => entry.pageId === page.pageId)
        )
      ),
      '',
      `Judge exactly these pages: ${candidate.missing.map((page) => page.pageId).join(', ')}`
    ].join('\n'),
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 2, maxToolCalls: 2 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(groupAssessmentResultSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

export type GroupAssessment = {
  pageId: string;
  outcome: (typeof structuralAssessmentOutcomes)[number];
  reasoning: string;
};

// Lenient by design, exactly like the review stage: an unusable assessor payload must not fail the
// run or publish. Every page the assessor did not (validly) judge stays 'uncertain', which produces
// no finding — the fail-quiet direction.
export const assessmentsFromTranscript = (
  transcript: Transcript,
  candidate: FacetCandidate
): { assessments: GroupAssessment[]; warnings: string[] } => {
  const judged = new Set(candidate.missing.map((page) => page.pageId));
  if (transcript.result?.type === 'structured') {
    const parsed = groupAssessmentResultSchema.safeParse(transcript.result.value);
    if (parsed.success) {
      const assessments = parsed.data.assessments.filter((entry) => judged.has(entry.pageId));
      const seen = new Set(assessments.map((entry) => entry.pageId));
      const unjudged = [...judged].filter((pageId) => !seen.has(pageId));
      return {
        assessments: [
          ...assessments,
          ...unjudged.map((pageId) => ({
            pageId,
            outcome: 'uncertain' as const,
            reasoning: 'the assessor returned no verdict for this page'
          }))
        ],
        warnings:
          unjudged.length === 0
            ? []
            : [
                `group assessor for "${candidate.facetTitle}" in "${candidate.groupId}" judged ${assessments.length} of ${judged.size} pages; the rest stay uncertain`
              ]
      };
    }
  }
  return {
    assessments: [...judged].map((pageId) => ({
      pageId,
      outcome: 'uncertain' as const,
      reasoning: 'the assessor returned no valid verdict'
    })),
    warnings: [
      `group assessor for "${candidate.facetTitle}" in "${candidate.groupId}" returned no valid assessment (stop: ${transcript.stopReason}); no finding was raised`
    ]
  };
};

// Impact is repair ORDERING, not severity: the stronger the convention, the more a missing section
// stands out to a reader moving between siblings.
const impactForPrevalence = (prevalence: number): 'low' | 'medium' | 'high' =>
  prevalence >= 0.85 ? 'high' : prevalence >= 0.7 ? 'medium' : 'low';

export const groupAssessmentScopeFingerprint = (candidate: FacetCandidate): string =>
  contentHashSchema.parse(
    hashValue(
      candidate.cohort
        .map((page) => ({ pageId: page.pageId, outlineHash: page.outlineHash, exceptions: page.structuralExceptions }))
        .toSorted((left, right) => left.pageId.localeCompare(right.pageId))
    )
  );

// ONE finding per candidate, naming ONLY the pages judged 'expected' (decision 20). Pages judged
// not-applicable or uncertain appear nowhere in it — not in repairTargets, not in evidence — so
// `refine` can never reroll a sibling the assessor cleared.
export const buildSiblingAsymmetryFinding = (input: {
  candidate: FacetCandidate;
  assessments: readonly GroupAssessment[];
  model: string;
}): StructuralFinding | undefined => {
  const expected = input.assessments.filter((entry) => entry.outcome === 'expected');
  if (expected.length === 0) {
    return undefined;
  }
  const { candidate } = input;
  const byPageId = new Map(candidate.cohort.map((page) => [page.pageId, page]));
  return structuralFindingSchema.parse({
    schemaVersion: 1,
    key: structuralFindingKey(['structure.sibling-facet-asymmetry', candidate.groupId, candidate.facet]),
    code: 'structure.sibling-facet-asymmetry',
    scope: { kind: 'nav-group', groupId: candidate.groupId, pageIds: candidate.cohort.map((page) => page.pageId) },
    detector: {
      kind: 'ai-assessed',
      id: groupAssessorDetectorId,
      version: structuralDetectorVersion,
      model: input.model
    },
    authority: { kind: 'inferred-convention', cohortSize: candidate.cohortSize, prevalence: candidate.prevalence },
    impact: impactForPrevalence(candidate.prevalence),
    status: { state: 'open' },
    evidence: expected.map((entry) => ({
      pageId: entry.pageId,
      detail: `${byPageId.get(entry.pageId)?.brief ?? entry.pageId} — ${entry.reasoning}`
    })),
    repairTargets: expected.map((entry) => entry.pageId),
    message:
      `AI-assessed structural inconsistency: ${expected.length} of ${candidate.cohortSize} pages in ` +
      `"${candidate.groupTitle ?? candidate.groupId}" are missing the "${candidate.facetTitle}" section their ` +
      'siblings share.',
    rationale:
      `${candidate.present.length} of ${candidate.cohortSize} comparable siblings carry "${candidate.facetTitle}". ` +
      `${candidate.missing.length} lack it; the assessor judged ${expected.length} of those as expected to have it ` +
      `and ${candidate.missing.length - expected.length} as not applicable or uncertain.`,
    scopeFingerprint: groupAssessmentScopeFingerprint(candidate)
  });
};

// THE COST KEY (decision 7). At most one assessment per changed group, reusable across runs while
// nothing that could change the answer moved: the IA/group plan, the cohort's outline structure,
// the detector and prompt versions, and the model. Deliberately NOT keyed on locale — renditions
// are structurally isomorphic to the canonical page, so a 12-locale project still pays once.
export const groupAssessmentCacheKey = (input: { candidate: FacetCandidate; model: string }): string =>
  hashValue({
    detector: groupAssessorDetectorId,
    detectorVersion: structuralDetectorVersion,
    promptVersion: groupAssessorPromptVersion,
    model: input.model,
    groupId: input.candidate.groupId,
    facet: input.candidate.facet,
    // The group PLAN fingerprint: cohort membership plus each member's brief/persona/profile —
    // everything the assessor reasons FROM, beyond the outlines.
    groupPlan: input.candidate.cohort
      .map((page) => ({
        pageId: page.pageId,
        brief: page.brief,
        primaryPersona: page.primaryPersona,
        structureProfile: page.structureProfile,
        plan: page.plan
      }))
      .toSorted((left, right) => left.pageId.localeCompare(right.pageId)),
    memberOutlineHashes: input.candidate.cohort
      .map((page) => ({ pageId: page.pageId, outlineHash: page.outlineHash }))
      .toSorted((left, right) => left.pageId.localeCompare(right.pageId))
  });
