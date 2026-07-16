import { z } from 'zod';
import type { AgentTaskSpec, Codemap, DocstubeConfig, Ia, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, iaNodeSchema, idPrefixes, mintId } from '@docstube/contracts';
import type { ProjectDetection } from '../detect/detect-project.ts';

// IA proposal task (PRODUCT §3.9.2 step 5): the wizard shows a segmented control of EXACTLY three
// agent-generated IA proposals — "A: task-oriented · B: by-module · C: user-journey" — each with a
// one-line rationale and a full editable tree (briefs + depth budgets). Any user edit forks to
// "Custom"; this module only produces the three starting points.

export const iaProposalIds = ['task-oriented', 'by-module', 'user-journey'] as const;
export type IaProposalId = (typeof iaProposalIds)[number];

const proposalSchema = z.object({
  id: z.enum(iaProposalIds),
  label: z.string().min(1),
  // One line: why this organization fits this project.
  rationale: z.string().min(1),
  tree: z.array(iaNodeSchema).min(1),
  pageCountTarget: z.number().int().positive().optional()
});

export const iaProposalsResultSchema = z.object({ proposals: z.array(proposalSchema).length(3) });

export type IaProposal = {
  id: IaProposalId;
  label: string;
  rationale: string;
  ia: Ia;
};

// Copied from write-page.ts (symbolSummary) rather than imported — that file is being reworked in
// a parallel workstream; keep the two in sync when either changes.
const symbolSummary = (codemap: Codemap, cap = 200): string => {
  const publicSymbols = codemap.symbols.filter((symbol) => symbol.visibility === 'public');
  const lines = publicSymbols
    .slice(0, cap)
    .map(
      (symbol) =>
        `- ${symbol.kind} \`${[...symbol.containerPath, symbol.name].join('.')}\` (${symbol.file}:${symbol.span[0]})`
    );
  const truncated =
    publicSymbols.length > cap ? `\n…and ${publicSymbols.length - cap} more (use tools to explore)` : '';
  return lines.join('\n') + truncated;
};

export type ProposeIaInput = {
  codemap: Codemap;
  config: DocstubeConfig;
  detection?: ProjectDetection | undefined;
};

const proposeIaSystemPrompt = (input: ProposeIaInput): string => {
  const personas = input.config.personas.map((persona) => `- ${persona.id}: ${persona.description}`).join('\n');
  return [
    'You are the docstube information architect. Propose the navigation structure for a documentation site.',
    '',
    'Produce EXACTLY three complete proposals, in this order:',
    '- id "task-oriented" — organized around what readers are trying to accomplish (tasks, how-tos, goals).',
    '- id "by-module" — organized around the code structure (packages, modules, subsystems).',
    '- id "user-journey" — organized around the reader\'s journey (evaluate → get started → go deep → operate).',
    '',
    'Rules for every proposal:',
    '- `label` is a short human name; `rationale` is ONE line: why this organization fits THIS project.',
    '- `tree` is the full IA: every node has `title` and a URL-safe `slug` (lowercase, hyphen-separated).',
    '- Every node that should become a page carries a `brief` (2-3 sentences seeding the writer: what the page',
    '  covers, for whom, and what the reader can do afterwards). Nodes without a brief are pure grouping nodes.',
    '- Give every page node a `depth` budget: "overview", "standard", or "deep".',
    '- Never set `pageId` — the kernel assigns page identities later.',
    '- Ground the structure in the real public API surface below; never invent modules or features.',
    '',
    `Project: ${input.config.projectContext || input.config.site.title}`,
    `Doc type: ${input.config.docType}`,
    `Audience personas:\n${personas}`
  ].join('\n');
};

const proposeIaUserPrompt = (input: ProposeIaInput): string => {
  const detection = input.detection;
  const detectionLines =
    detection === undefined
      ? []
      : [
          '',
          'Deterministic project detection:',
          ...(detection.languages.length > 0 ? [`- languages: ${detection.languages.join(', ')}`] : []),
          ...(detection.frameworks.length > 0 ? [`- frameworks: ${detection.frameworks.join(', ')}`] : []),
          ...(detection.openapiSpecs.length > 0 ? [`- OpenAPI specs: ${detection.openapiSpecs.join(', ')}`] : []),
          ...(detection.asyncapiSpecs.length > 0 ? [`- AsyncAPI specs: ${detection.asyncapiSpecs.join(', ')}`] : []),
          ...(detection.monorepo ? ['- monorepo: yes'] : [])
        ];
  return [
    'Propose the three information architectures for this project.',
    '',
    'Public API surface (from the verified codemap):',
    symbolSummary(input.codemap),
    ...detectionLines
  ].join('\n');
};

export const buildProposeIaTask = (input: ProposeIaInput): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'propose-ia',
    systemPrompt: proposeIaSystemPrompt(input),
    userPrompt: proposeIaUserPrompt(input),
    tools: [],
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 4, maxToolCalls: 4 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(iaProposalsResultSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

// Models sometimes decorate nodes with pageId anyway; strip it everywhere before validating so a
// cosmetic slip does not void an otherwise good proposal.
const stripPageIds = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripPageIds);
  }
  if (value !== null && typeof value === 'object') {
    const { pageId: _pageId, ...rest } = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(rest).map(([key, entry]) => [key, stripPageIds(entry)]));
  }
  return value;
};

export type IaProposalsResult = { proposals: IaProposal[]; warnings: string[] };

// Same lenient-failure shape as the review stage: an invalid proposal payload never throws — the
// wizard shows an empty segmented control plus the warning, and the user builds the IA by hand.
export const proposalsFromTranscript = (transcript: Transcript): IaProposalsResult => {
  if (transcript.result?.type === 'structured') {
    const parsed = iaProposalsResultSchema.safeParse(stripPageIds(transcript.result.value));
    if (parsed.success) {
      return {
        proposals: parsed.data.proposals.map((proposal) => ({
          id: proposal.id,
          label: proposal.label,
          rationale: proposal.rationale,
          ia: {
            schemaVersion: 1,
            tree: proposal.tree,
            ...(proposal.pageCountTarget === undefined ? {} : { pageCountTarget: proposal.pageCountTarget })
          }
        })),
        warnings: []
      };
    }
  }
  return {
    proposals: [],
    warnings: [`ia-proposal task returned no valid proposals (stop: ${transcript.stopReason}); start from a blank tree`]
  };
};
