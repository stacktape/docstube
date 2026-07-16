import { z } from 'zod';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type { AgentTaskSpec, DocstubeConfig, Persona, ReviewResult, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId, reviewResultSchema } from '@docstube/contracts';
import type { RunJournal } from '../state/run-journal.ts';
import type { RunCostTracker } from './run-cost.ts';

// The review stage (PRODUCT §3.5 stage 4): one reviewer per persona, audience-fit and
// correctness-risk findings, scores derived from explainable criteria only — never an opaque
// judge number. Review findings with severity `error` feed the same bounded retry loop as
// deterministic findings; they never assign guarantees (that is the verify stage's job).

export const defaultReviewCriteria = [
  'audience-fit: the page addresses this persona directly — assumed knowledge, terminology, and depth match the persona description.',
  'correctness-risk: every concrete claim about behavior, defaults, or APIs is plausible given the provided source context; anything that smells invented is a finding.',
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
    '- Never rewrite the page; never invent facts about the codebase; judge only what is in front of you.'
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
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 4 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(reviewResultSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

export type ReviewPageInput = {
  config: DocstubeConfig;
  criteria: string[];
  artifact: PageArtifact;
  brief?: string | undefined;
  runTask: (spec: AgentTaskSpec) => Promise<Transcript>;
  journal: RunJournal;
  // Run-cost accounting (optional so direct callers/tests without a run budget stay simple).
  costTracker?: RunCostTracker | undefined;
};

const reviewFromTranscript = (persona: Persona, transcript: Transcript): ReviewResult => {
  if (transcript.result?.type === 'structured') {
    const parsed = reviewResultSchema.safeParse(transcript.result.value);
    if (parsed.success) {
      return parsed.data;
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
    ]
  };
};

export const reviewPage = async (input: ReviewPageInput): Promise<ReviewResult[]> => {
  const criteria = input.criteria.length > 0 ? input.criteria : [...defaultReviewCriteria];
  const reviews: ReviewResult[] = [];
  for (const persona of input.config.personas) {
    const task = buildReviewPageTask({ persona, criteria, artifact: input.artifact, brief: input.brief });
    await input.journal.append({ type: 'task-started', taskId: task.id, pageId: input.artifact.page.id });
    const transcript = await input.runTask(task);
    await input.journal.append({
      type: 'task-completed',
      taskId: task.id,
      pageId: input.artifact.page.id,
      usage: transcript.usage
    });
    input.costTracker?.add(transcript.usage);
    reviews.push(reviewFromTranscript(persona, transcript));
  }
  return reviews;
};
