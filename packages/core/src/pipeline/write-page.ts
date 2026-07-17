import type { AgentTaskSpec, Codemap, DocstubeConfig, Finding, Glossary, IaNode } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';

// Prompt assembly for the write-page task. The writer gets seed context (recorded as provenance
// input) and the standard read-only tools — everything it reads on top is captured by the harness
// as observed reads (PRODUCT §3.5 stage 3).

export type WritePromptInput = {
  config: DocstubeConfig;
  glossary: Glossary;
  codemap: Codemap;
  node: IaNode;
  // Findings from a failed gate attempt, attached on retry.
  priorFindings: Finding[];
  // The failed attempt's MDX, attached on retry so the writer edits it instead of rewriting.
  priorDraft?: string | undefined;
  enabledComponents: string[];
  // Durable writing instructions from .docstube/instructions/ (feedback learning).
  instructions: string[];
  // Answered maintainer questions from .docstube/knowledge/ (tribal-knowledge capture).
  knowledge: Array<{ question: string; answer: string }>;
};

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

export const buildWriterSystemPrompt = (input: WritePromptInput): string => {
  const personas = input.config.personas.map((persona) => `- ${persona.id}: ${persona.description}`).join('\n');
  const glossaryTerms = input.glossary.terms
    .map(
      (term) =>
        `- ${term.term}: ${term.definition}${term.avoid.length > 0 ? ` (never say: ${term.avoid.join(', ')})` : ''}`
    )
    .join('\n');
  const components =
    input.enabledComponents.length > 0
      ? `You may use these MDX components (no others): ${input.enabledComponents.join(', ')}.`
      : 'Use plain Markdown/MDX primitives only — no custom components are enabled.';
  return [
    'You are the docstube writer. You produce documentation where every claim will be mechanically verified;',
    'anything you assert that the code does not support will be caught and rejected. Never invent behavior.',
    '',
    'Hard rules:',
    '- Read the actual source with the provided tools before describing behavior. Base every claim on code you read.',
    '- Output pure MDX: frontmatter (title, description), then content. Exactly one H1. No entity ids, no HTML comments.',
    '- Frontmatter must be valid YAML: double-quote the title and description values.',
    '- Never write import/export statements and never set a `layout` frontmatter key — the site build provides both.',
    `- ${components}`,
    '- Code examples must be complete and correct — they are compiled and executed.',
    '- If something cannot be known from the code (intent, history, "why"), use the `flag_question` tool to ask the',
    '  maintainers, then keep writing with what IS knowable. Never block on it; never invent the answer.',
    '',
    `Project: ${input.config.projectContext || input.config.site.title}`,
    `Audience personas:\n${personas}`,
    ...(glossaryTerms.length > 0 ? ['', `Glossary (use these terms exactly):\n${glossaryTerms}`] : []),
    ...(input.instructions.length > 0
      ? ['', 'Project writing instructions (learned from feedback — follow every one):', ...input.instructions]
      : []),
    ...(input.knowledge.length > 0
      ? [
          '',
          'Maintainer-provided knowledge (answers to earlier questions — trustworthy, cite freely, do not re-ask):',
          ...input.knowledge.map((entry) => `- Q: ${entry.question}\n  A: ${entry.answer}`)
        ]
      : [])
  ].join('\n');
};

export const buildWriterUserPrompt = (input: WritePromptInput): string => {
  const findingLines = input.priorFindings.map(
    (finding) => `- [${finding.check}] ${finding.message}${finding.file ? ` (${finding.file})` : ''}`
  );
  const findingsBlock =
    input.priorFindings.length > 0
      ? input.priorDraft === undefined
        ? [
            '',
            'Your previous draft FAILED verification. Fix every finding below; change nothing that was not flagged:',
            ...findingLines
          ]
        : [
            '',
            'Your previous draft FAILED verification. Edit the draft below to fix every finding; change nothing',
            'that was not flagged. Output the complete corrected page.',
            '',
            '--- PREVIOUS DRAFT START ---',
            input.priorDraft,
            '--- PREVIOUS DRAFT END ---',
            '',
            'Findings to fix:',
            ...findingLines
          ]
      : [];
  return [
    `Write the documentation page "${input.node.title}" (slug: ${input.node.slug}).`,
    `Page brief: ${input.node.brief ?? input.node.title}`,
    `Depth budget: ${input.node.depth ?? 'standard'}.`,
    '',
    'Public API surface (from the verified codemap — cite these, explore with tools for detail):',
    symbolSummary(input.codemap),
    ...findingsBlock
  ].join('\n');
};

export const buildWritePageTask = (
  input: WritePromptInput & { toolDescriptors: AgentTaskSpec['tools'] }
): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'write-page',
    systemPrompt: buildWriterSystemPrompt(input),
    userPrompt: buildWriterUserPrompt(input),
    tools: input.toolDescriptors,
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: {
      maxTurns: input.config.agents.budgets.maxTurnsPerTask,
      maxToolCalls: input.config.agents.budgets.maxToolCallsPerTask
    },
    output: { type: 'mdx' }
  });
