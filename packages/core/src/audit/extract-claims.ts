import { z } from 'zod';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, claimAnchorSchema, claimClassSchema, idPrefixes, mintId } from '@docstube/contracts';
import type { ForeignDocPage } from './parse-foreign-docs.ts';

// One 'audit-extract-claims' task per foreign page (a known agent task kind in
// @docstube/contracts). The agent only EXTRACTS — every judgement about whether a claim holds is
// deterministic and lives in match-claims.ts. Structured output reuses the shared claim contracts
// (claimAnchorSchema / claimClassSchema) so audit claims and generated-docs claims stay one model.

export const maxClaimsPerPage = 30;

export const extractedClaimSchema = z.object({
  text: z.string().min(1),
  anchor: claimAnchorSchema,
  claimClass: claimClassSchema,
  // Backtick-quoted or obviously-referenced code identifiers the claim's truth depends on.
  identifiers: z.array(z.string().min(1)).default([])
});
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;

export const extractedClaimsResultSchema = z.object({
  claims: z.array(extractedClaimSchema)
});

const extractClaimsSystemPrompt = [
  'You extract CHECKABLE factual claims from a documentation page so a deterministic tool can verify them against the code.',
  '',
  'Extract ONLY claims that concrete tooling could check: API shapes, existence of functions/classes/types/methods, default values, CLI flags, configuration keys, concrete code behavior.',
  'NEVER extract opinions, marketing language, tutorial narration, or vague statements.',
  '',
  'For each claim emit:',
  '- text: the claim restated as one checkable sentence.',
  '- anchor: { quote, prefix?, suffix? } — quote is an EXACT substring of the page copied verbatim; prefix/suffix are short surrounding snippets that disambiguate it.',
  '- claimClass: one of factual | api-shape | behavioral | code-sample | structural | configuration (lowercase, hyphenated).',
  '- identifiers: the code identifiers the claim depends on — backtick-quoted names or names obviously referenced by the text (function, class, method, type, config key). Use dotted paths like Class.method when the page qualifies them. Leave [] when the claim references no code identifier.',
  '',
  `Cap the output at ${maxClaimsPerPage} claims; when a page has more, keep the most load-bearing ones (API existence and shape first).`,
  'Respond with the structured output only.'
].join('\n');

const extractClaimsUserPrompt = (input: { file: string; markdown: string }): string =>
  [
    `Extract checkable claims from the documentation page "${input.file}".`,
    '',
    '--- PAGE START ---',
    input.markdown,
    '--- PAGE END ---'
  ].join('\n');

export const buildExtractClaimsTask = (page: Pick<ForeignDocPage, 'file' | 'markdown'>): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'audit-extract-claims',
    systemPrompt: extractClaimsSystemPrompt,
    userPrompt: extractClaimsUserPrompt(page),
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 4 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(extractedClaimsResultSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

// A broken extractor must not kill the audit or invent claims: zero claims + a warning.
export const claimsFromTranscript = (
  file: string,
  transcript: Transcript
): { claims: ExtractedClaim[]; warning?: string } => {
  if (transcript.result?.type === 'structured') {
    const parsed = extractedClaimsResultSchema.safeParse(transcript.result.value);
    if (parsed.success) {
      // The cap is enforced deterministically even when the model ignores it.
      return { claims: parsed.data.claims.slice(0, maxClaimsPerPage) };
    }
  }
  return {
    claims: [],
    warning: `claim extraction for "${file}" returned no valid claims (stop: ${transcript.stopReason}); page counted with zero claims`
  };
};
