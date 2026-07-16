import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AgentTaskSpec, EntityAddress, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';

// Review-UI feedback intake (PRODUCT §3.9.4 + §3.3): feedback anchors to entities and is routed
// by the categorizer into durable, committed learning files — criteria and writing instructions
// are read by the writer/reviewers on every future generation (context-files.ts); glossary notes
// collect terminology feedback for folding into glossary.yaml. Every entry carries the entity
// address as a comment line so the anchor survives file reorganization.

export const feedbackCategories = ['criteria', 'instructions', 'glossary'] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

// Repo-relative POSIX targets; criteria/instructions land where loadContextFiles() reads.
const categoryTargets: Record<FeedbackCategory, string> = {
  criteria: '.docstube/criteria/ui-feedback.md',
  instructions: '.docstube/instructions/ui-feedback.md',
  glossary: '.docstube/glossary/ui-feedback.md'
};

const categoryHeaders: Record<FeedbackCategory, string> = {
  criteria: '# Review criteria learned from UI feedback\n',
  instructions: '# Writing instructions learned from UI feedback\n',
  glossary: '# Glossary notes from UI feedback (fold into glossary.yaml)\n'
};

// Durable anchoring: entity ids are stable across regenerations (PRODUCT §3.1), so the comment
// line keeps each entry attributable long after the feedback session ended.
export const entityAnchorComment = (entity: EntityAddress): string =>
  `<!-- entity: version=${entity.version} locale=${entity.locale} page=${entity.pageId}${
    entity.entityId === undefined ? '' : ` entity=${entity.entityId}`
  } -->`;

export type FeedbackEntryInput = {
  category: FeedbackCategory;
  entity: EntityAddress;
  text: string;
};

export const appendFeedbackEntry = async (repoRoot: string, input: FeedbackEntryInput): Promise<{ file: string }> => {
  const relativePath = categoryTargets[input.category];
  const path = join(repoRoot, ...relativePath.split('/'));
  await mkdir(dirname(path), { recursive: true });
  let exists = true;
  try {
    await stat(path);
  } catch {
    exists = false;
  }
  if (!exists) {
    await writeFile(path, categoryHeaders[input.category], 'utf8');
  }
  const entry = [
    '',
    `## ${new Date().toISOString()}`,
    '',
    entityAnchorComment(input.entity),
    '',
    input.text.trim(),
    ''
  ].join('\n');
  await appendFile(path, entry, 'utf8');
  return { file: relativePath };
};

export const feedbackCategorizationSchema = z.object({
  category: z.enum(feedbackCategories),
  // The feedback restated as a durable, generally-applicable rule/note (imperative, one entry).
  refined: z.string().min(1)
});

const categorizerSystemPrompt = (): string =>
  [
    'You are the docstube feedback categorizer. A user left feedback on a rendered documentation entity.',
    'Route it into exactly one durable learning channel:',
    '- "criteria" — it describes how pages should be JUDGED (review standards, quality bars, what counts as a problem).',
    '- "instructions" — it describes how pages should be WRITTEN (tone, structure, depth, formatting, examples).',
    '- "glossary" — it is about terminology: what to call things, terms to define, terms to avoid.',
    '',
    'Also produce `refined`: the feedback restated as one durable, generally-applicable rule that will make sense',
    "to a writer or reviewer years from now, stripped of session-specific phrasing. Preserve the user's intent",
    'exactly — never add requirements they did not state.'
  ].join('\n');

const categorizerUserPrompt = (input: { text: string; entity: EntityAddress }): string =>
  [
    `Feedback on entity ${input.entity.pageId}${input.entity.entityId === undefined ? '' : `#${input.entity.entityId}`}`,
    `(version ${input.entity.version}, locale ${input.entity.locale}):`,
    '',
    '--- FEEDBACK START ---',
    input.text,
    '--- FEEDBACK END ---'
  ].join('\n');

export const buildCategorizeFeedbackTask = (input: { text: string; entity: EntityAddress }): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'categorize-feedback',
    systemPrompt: categorizerSystemPrompt(),
    userPrompt: categorizerUserPrompt(input),
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 2, maxToolCalls: 1 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(feedbackCategorizationSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

export type FeedbackCategorization = {
  category: FeedbackCategory;
  refined?: string | undefined;
  warnings: string[];
};

// Lenient failure: a broken categorizer must not lose the feedback — default to "instructions"
// (the broadest channel) with the ORIGINAL text and surface a warning.
export const categorizationFromTranscript = (transcript: Transcript): FeedbackCategorization => {
  if (transcript.result?.type === 'structured') {
    const parsed = feedbackCategorizationSchema.safeParse(transcript.result.value);
    if (parsed.success) {
      return { category: parsed.data.category, refined: parsed.data.refined, warnings: [] };
    }
  }
  return {
    category: 'instructions',
    warnings: [
      `feedback categorizer returned no valid result (stop: ${transcript.stopReason}); stored verbatim under instructions`
    ]
  };
};
