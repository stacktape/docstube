import { z } from 'zod';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type { AgentTaskSpec, DocstubeConfig, Persona, ReviewResult, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId, reviewResultSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { runRecordedTask } from './agent-task-record.ts';
import type { RunCostTracker } from './run-cost.ts';

// The review stage (PRODUCT §3.5 stage 4, harness-state-v2 decision 4): one EDITORIAL reviewer
// per page — the primary persona judging audience fit and brief conformance only, with scores
// derived from explainable criteria, never an opaque judge number. Review findings with severity
// `error` feed the same bounded retry loop as deterministic findings. FACTUAL correctness is
// deliberately NOT a persona-review axis (impl-07 finding 9): it belongs to ClaimEvidence (the
// mechanical claim spine) plus the separate evidence-fed risk critic, which is a later wave.

export const defaultReviewCriteria = [
  'audience-fit: the page addresses this persona directly — assumed knowledge, terminology, and depth match the persona description.',
  'brief-conformance: the page covers what its brief promises — no major omission, no off-brief padding.'
] as const;

const reviewerSystemPrompt = (persona: Persona, criteria: string[]): string =>
  [
    `You are a documentation reviewer embodying one persona: ${persona.id} — ${persona.description}.`,
    'Judge the page ONLY through this persona. Apply each criterion below and report an explainable outcome for every one.',
    '',
    'Criteria:',
    ...criteria.map((criterion) => `- ${criterion}`),
    '',
    'Rules:',
    '- `outcome` per criterion: met | not-met | not-applicable, with 1-3 sentences of reasoning grounded in the page text.',
    '- Emit a finding for each concrete problem: severity `error` only when the page would mislead or block this persona; otherwise `warning`.',
    "- findings[].source is always 'review'; findings[].check is the criterion name (e.g. 'audience-fit').",
    '- Do NOT judge factual correctness of claims about code, defaults, or APIs — mechanical claim verification and a separate risk critic own that axis; you judge audience fit and brief conformance only.',
    '- Never rewrite the page; never invent facts about the codebase.'
  ].join('\n');

const reviewerUserPrompt = (artifact: PageArtifact, brief: string | undefined): string =>
  [
    `Review the page "${artifact.page.title}" (slug: ${artifact.page.slug}).`,
    brief === undefined ? '' : `Page brief: ${brief}`,
    '',
    '--- PAGE MDX START ---',
    artifact.mdx,
    '--- PAGE MDX END ---'
  ].join('\n');

export const buildReviewPageTask = (input: {
  persona: Persona;
  criteria: string[];
  artifact: PageArtifact;
  brief?: string | undefined;
}): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'review-page',
    systemPrompt: reviewerSystemPrompt(input.persona, input.criteria),
    userPrompt: reviewerUserPrompt(input.artifact, input.brief),
    // Editorial review judges the page text against the persona and brief — it needs NO source
    // tooling (impl-07 finding 9): source checking was the removed correctness-risk axis, owned
    // by claim verification and the future risk critic.
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 1 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(reviewResultSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

export type ReviewPageInput = {
  config: DocstubeConfig;
  criteria: string[];
  artifact: PageArtifact;
  // The page's primary persona (ia.yml v2): ONLY this persona's review runs and gates in this
  // slice. Sampled secondary-persona reviews are ADVISORY and arrive with the review-routing
  // wave — they are deliberately not run here (PRODUCT §3.5 stage 7).
  primaryPersona: string;
  brief?: string | undefined;
  runTask: (spec: AgentTaskSpec) => Promise<Transcript>;
  journal: RunJournal;
  // Run-cost accounting (optional so direct callers/tests without a run budget stay simple).
  costTracker?: RunCostTracker | undefined;
};

// A review result plus the execution metadata provenance-v2 assessments need: which model scored
// it, the review task id (transcript pointer into the run journal), and whether the reviewer
// actually completed (invalid output = a recorded 'failed' review, never a missing record).
export type ScoredReview = ReviewResult & {
  scoredBy: string;
  taskId: string;
  completed: boolean;
};

const reviewFromTranscript = (persona: Persona, transcript: Transcript): ReviewResult & { completed: boolean } => {
  if (transcript.result?.type === 'structured') {
    const parsed = reviewResultSchema.safeParse(transcript.result.value);
    // A review with ZERO criterion outcomes evaluated nothing — it must never count as completed
    // (impl-08 new defect: the "reviewed" label requires nonempty evaluated criteria; the
    // personaReview schema rejects completed-with-empty-criteria at parse time too).
    if (parsed.success && parsed.data.criteria.length > 0) {
      return { ...parsed.data, completed: true };
    }
  }
  // A broken reviewer must not kill the run or silently pass: surface it as a warning finding.
  return {
    persona: persona.id,
    criteria: [],
    findings: [
      {
        source: 'review',
        check: 'review-error',
        severity: 'warning',
        message: `reviewer for persona "${persona.id}" returned no valid review (stop: ${transcript.stopReason}); page shipped without this persona's review`
      }
    ],
    completed: false
  };
};

export const reviewPage = async (input: ReviewPageInput): Promise<ScoredReview[]> => {
  const criteria = input.criteria.length > 0 ? input.criteria : [...defaultReviewCriteria];
  const reviews: ScoredReview[] = [];
  // Primary persona ONLY (finding 6): every configured persona reviewing — and every one gating —
  // recorded false 'primary-gating' assessments and burned review calls per persona per attempt.
  const primary = input.config.personas.find((persona) => persona.id === input.primaryPersona);
  if (primary === undefined) {
    throw new CoreError(
      'config-invalid',
      `page primary persona "${input.primaryPersona}" is not a configured persona (personas: ${input.config.personas
        .map((persona) => persona.id)
        .join(', ')})`
    );
  }
  for (const persona of [primary]) {
    const task = buildReviewPageTask({
      persona,
      criteria,
      artifact: input.artifact,
      brief: input.brief
    });
    const transcript = await runRecordedTask({
      runTask: input.runTask,
      journal: input.journal,
      task,
      costTracker: input.costTracker,
      pageId: input.artifact.page.id
    });
    reviews.push({ ...reviewFromTranscript(persona, transcript), scoredBy: transcript.model, taskId: task.id });
  }
  return reviews;
};
