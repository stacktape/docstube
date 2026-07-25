import type { AgentTaskSpec, Codemap, DocstubeConfig, Finding, Glossary, IaPageNodeV2 } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';

// Prompt assembly for the write-page task. The writer gets seed context (recorded as provenance
// input) and the standard read-only tools — everything it reads on top is captured by the harness
// as observed reads (PRODUCT §3.5 stage 3).

export type WritePromptInput = {
  config: DocstubeConfig;
  glossary: Glossary;
  codemap: Codemap;
  // The page's ia.yml v2 record: title, brief, depth, and the PRIMARY persona (release-scope-v2).
  node: IaPageNodeV2;
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
  // The symbol hash rides along because claim ledgers reference symbols by hash, never by name.
  const lines = publicSymbols
    .slice(0, cap)
    .map(
      (symbol) =>
        `- ${symbol.kind} \`${[...symbol.containerPath, symbol.name].join('.')}\` (${symbol.file}:${symbol.span[0]}) hash=${symbol.hash}`
    );
  const truncated =
    publicSymbols.length > cap ? `\n…and ${publicSymbols.length - cap} more (use tools to explore)` : '';
  return lines.join('\n') + truncated;
};

// The claim-aware authorship contract (ARCHITECTURE §4.1): every assertion carries an inline
// marker plus a ledger entry, and the page is delivered ONLY through submit_page.
const claimAuthorshipRules = [
  'Claim-aware authorship (required):',
  '- Wrap every assertion-shaped statement — a fact about the code a reader could rely on (an API exists, a default',
  '  value, a runtime behavior, a why/history fact) — in an inline marker: <Claim id="c1">`greet` returns a',
  '  string.</Claim>. Marker ids are short page-unique tokens (c1, c2, …). Markers must wrap the asserted prose,',
  '  never be empty or self-closing, and never nest.',
  '- ONE marker = ONE atomic fact. A sentence asserting two facts gets two markers (or is split); never bundle',
  '  "`greet` exists and defaults `loud` to false" under a single marker.',
  '- Marker placement: markers are INLINE elements inside body prose (paragraphs, list items, table cells).',
  '  Never place a marker in a heading, inside a code block or inline code, in frontmatter, inside a JSX',
  '  expression, or around text that is only a link. Keep the opening tag, the wrapped prose, and </Claim> on the',
  '  same line inside the sentence — a marker formatted as its own block-level element is rejected.',
  '- The predicate must agree with the visible wrapped text: every identifier, value, quantity, and negation in the',
  '  predicate appears in the prose the marker wraps (and vice versa). Never wrap "`retries` defaults to 3" with a',
  '  predicate about a different symbol, a different number, or the opposite polarity.',
  '- A deterministic coverage linter reads the prose OUTSIDE your markers: any sentence that names a code',
  '  identifier and asserts something about it (a number, or "defaults to"/"returns"/"requires"/"must"/"always"/',
  '  "never"/"is exported"…) is reported as an UNMARKED ASSERTION, and a page with even one of them can never show',
  '  a complete badge — so wrap every such fact in a marker with its ledger entry, or reword it as plain narrative.',
  '- Negative assertions ("X does not exist", "X never throws") cannot be mechanically checked in 0.1.0 and should',
  '  be avoided or phrased positively — the ledger accepts them, but they will show as unchecked.',
  '- CHECKABLE PHRASING IS FAIL-CLOSED (EXACT MATCH): mechanical checking only decides a claim whose marker wraps',
  '  EXACTLY one canonical assertion — nothing more. Existence: "`X` exists", "`X` is exported", "`X` is defined",',
  '  "`X` is available" ("is exported" is verified against the recorded exportedness — a non-exported symbol makes',
  '  it CONTRADICTED, so assert it only when exportedness is the point). Value: "`S` is 3", "`S` equals 3",',
  '  "`S` defaults to 3", "`S` is set to 3", where the subject S is EXACTLY the full bound value path as rendered:',
  '  the const name itself ("`DEFAULT_RETRIES` defaults to 3"), the dotted path for object properties and enum',
  '  members ("`retryDefaults.backoff.factor` is 2", "`LogLevel.Warn` is 30"), and the call-shaped form',
  '  "owner(param)" for parameter defaults ("`createClient(retries)` defaults to 3" for valueName',
  '  createClient.param.retries.default). The root object name alone is NOT checkable ("`retryDefaults` is 2" for a',
  '  nested path stays unchecked). Write numbers plainly, never quoted.',
  '  Inline-code backticks are fine (they are formatting and render bare), but the PREDICATE spells identifiers',
  '  bare, without backticks; a backslash-escaped backtick in the prose is literal content and breaks the match.',
  '  Checkable markers contain ONLY plain prose and backticked identifiers — no components, images, links,',
  '  footnotes, or formatting inside a checkable marker (such content is legal MDX but makes the claim',
  '  permanently unchecked). Checkable claims live in plain paragraphs and list items, never inside components:',
  '  a marker nested anywhere inside a component (e.g. <Badge><Claim …>…</Claim></Badge>) is legal MDX but the',
  '  claim is permanently unchecked — the component, not the kernel, decides what renders. Never put an MDX',
  '  expression ({…}) or a JSX component inside ANY marker — both are rejected outright. Whitespace and one trailing',
  '  period are tolerated; ANY other word or character inside the marker makes the claim unchecked. Surrounding',
  '  prose goes OUTSIDE the marker, inline in the same sentence: write',
  '  \'`greet` was added in v2. <Claim id="c1">`greet` exists.</Claim>\' — never',
  '  \'<Claim id="c1">`greet`, added in v2, exists.</Claim>\'. Non-canonical phrasing is accepted but ships as',
  '  honestly UNCHECKED.',
  "- BOTH the wrapped prose AND the predicate must NAME the subject of every symbol you cite: the symbol's real",
  '  declared ROOT identifier as the codebase spells it (e.g. "createClient" for the value path',
  '  createClient.param.retries.default). Naming only a path segment ("retries", "config") is NOT sufficient — the',
  '  root identifier must appear in the visible wrapped sentence AND in the predicate; segments are extra context',
  '  only. A claim whose wrapped sentence or predicate never names the subject is rejected as subject-unbound.',
  '- Deliver the page by calling the `submit_page` tool with { mdx, ledger }. Never print the page as chat text.',
  '  If submit_page reports errors, fix exactly what it lists and call it again with the full corrected page.',
  '- The ledger holds one entry per marker: { markerId, class, predicate, proposedEvidence, proposedSubscriptions }.',
  '  Emit ONLY those fields — claim ids, anchors, correctness, and evidence records are minted by the kernel.',
  "- class: 'code-structure' (a named API/config exists or has a shape), 'value' (a concrete value: default,",
  "  constant, limit), 'behavior' (what the code does at runtime), 'intent-history' (why/when — only when",
  '  maintainer-provided knowledge backs it).',
  '- predicate: the asserted fact restated as ONE standalone checkable sentence, stripped of surrounding prose.',
  '- proposedEvidence: where a verifier should look — { kind: "symbol", symbol: "<hash from the API surface list>" },',
  '  { kind: "file", file: "repo/relative/path" }, or { kind: "url", url: "https://…" }.',
  '  Report file/span only as you actually saw them — the kernel resolves the canonical location from the codemap',
  '  and rejects mismatching locations.',
  '- proposedSubscriptions: the exact code facets whose change invalidates the claim:',
  '  { kind: "signature", symbolHash } when the claim depends on a declaration shape;',
  '  { kind: "cited-value", symbolHash, valueName, citedValue } for every value claim — valueName uses the',
  '  cited-value grammar: an exported const name ("DEFAULT_RETRIES"), a dot path into an exported object literal',
  '  ("retryDefaults.backoff.factor"), an enum member ("LogLevel.Warn"), or a parameter default',
  '  ("createClient.param.timeout.default"); citedValue is the asserted value normalized (strings JSON-quoted,',
  '  plain numbers, true/false, null). The asserted value MUST appear verbatim in BOTH the prose the marker wraps',
  '  AND the predicate — a citedValue the visible sentence never states is rejected;',
  '  { kind: "body", symbolHash } when the claim depends on implementation details beyond the signature.',
  '  Use symbol hashes from the API surface list or from tool results — never invent a hash. When you have no real',
  '  symbol hash for a code-structure/value/behavior claim, propose a whole-file dependency instead:',
  '  { kind: "file-content", file: "<repo-relative file the fact came from>" } (no contentHash — the kernel fills',
  '  in the authoritative hash). Never leave a code-dependent claim with no subscription at all.',
  '- Behavior claims are marked like every other class but are honestly UNCHECKED at launch: no checker exists for',
  '  them yet (richer predicate verifiers arrive in v1.x), so they ship as unchecked with an explicit disposition —',
  '  that is fine and expected. Never inflate a behavior fact into a value/code-structure claim to game the counts.',
  '  Code examples are still executed as examples — make them complete and correct — but their execution never',
  '  checks a behavior claim.',
  '- Short valid examples, one per class (checkable markers wrap ONLY the canonical assertion; the rest of the',
  '  sentence stays outside):',
  '  code-structure: The entry point is stable: <Claim id="c1">`greet` exists.</Claim> — ledger: { markerId: "c1",',
  '    class: "code-structure", predicate: "greet exists", proposedEvidence:',
  '    [{ kind: "symbol", symbol: "<greet hash>" }], proposedSubscriptions: [{ kind: "signature", symbolHash: "<greet hash>" }] }',
  '  value: The client retries because <Claim id="c2">`DEFAULT_RETRIES` defaults to 3</Claim>. — ledger:',
  '    { markerId: "c2", class: "value", predicate: "DEFAULT_RETRIES defaults to 3", proposedEvidence:',
  '    [{ kind: "symbol", symbol: "<hash>" }],',
  '    proposedSubscriptions: [{ kind: "cited-value", symbolHash: "<hash>", valueName: "DEFAULT_RETRIES", citedValue: "3" }] }',
  '  behavior: <Claim id="c3">`greet` upper-cases the message when `loud` is true.</Claim> — ledger: { markerId: "c3",',
  '    class: "behavior", predicate: "greet returns the upper-cased greeting when options.loud is true",',
  '    proposedEvidence: [{ kind: "symbol", symbol: "<hash>" }], proposedSubscriptions: [{ kind: "body", symbolHash: "<hash>" }] }',
  '  intent-history: <Claim id="c4">Retries were added for flaky registries.</Claim> — ledger: { markerId: "c4",',
  '    class: "intent-history", predicate: "retry support was added to handle flaky registries", proposedEvidence: [],',
  '    proposedSubscriptions: [] } (only when maintainer knowledge backs it).'
].join('\n');

export const buildWriterSystemPrompt = (input: WritePromptInput): string => {
  const personas = input.config.personas.map((persona) => `- ${persona.id}: ${persona.description}`).join('\n');
  const glossaryTerms = input.glossary.terms
    .map(
      (term) =>
        `- ${term.term}: ${term.definition}${term.avoid.length > 0 ? ` (never say: ${term.avoid.join(', ')})` : ''}`
    )
    .join('\n');
  // ELEMENT WHITELIST, stated as the rule submit_page actually enforces (wave 2b close): only the
  // listed registered components may appear as elements, their props must be plain string
  // literals, and raw HTML is refused outright. The enforced list is exactly this list
  // (element-policy.ts), so the writer is never told something the gate will reject.
  const components =
    input.enabledComponents.length > 0
      ? `You may use these MDX components and NO others: ${input.enabledComponents.join(', ')}.`
      : 'Use plain Markdown/MDX primitives only — no components are enabled for this project.';
  return [
    'You are the docstube writer. You produce documentation where every claim will be mechanically verified;',
    'anything you assert that the code does not support will be caught and rejected. Never invent behavior.',
    '',
    'Hard rules:',
    '- Read the actual source with the provided tools before describing behavior. Base every claim on code you read.',
    '- The page is pure MDX: frontmatter (title, description), then content. Exactly one H1. No entity ids, no HTML comments.',
    '- Frontmatter must be valid YAML: double-quote the title and description values.',
    '- Never write import/export statements and never set a `layout` frontmatter key — the site build provides both.',
    `- ${components} The inline <Claim id> marker is always available — it is part of the claim contract, not a theme component.`,
    '- NO RAW HTML, EVER: never write <div>, <span>, <img>, <br>, <script>, <style>, or any other HTML tag, and never',
    '  a JSX fragment (<>…</>). The theme owns presentation — use ordinary Markdown, or one of the components listed',
    '  above. A code FENCE that SHOWS HTML is documentation and is always fine.',
    "- NO {…} EXPRESSIONS IN THE PAGE BODY: never {someValue}, {'text'}, {<Anything/>} or {<>…</>} standing in the",
    '  prose. An expression is evaluated when the page renders, so it can show the reader something the kernel never',
    '  checked. Write the literal text. Braces inside a code FENCE or `inline code` are documentation and stay fine.',
    '  (The one place braces are legal is a component prop carrying static literal data — see the prop rule below.)',
    '- COMPONENT PROPS ARE PLAIN STRING LITERALS OR STATIC LITERAL DATA. A text prop is written prop="value".',
    '  A STRUCTURED prop (a list or a table of rows, e.g. Steps items, Tabs tabs, FileTree entries, ParamTable',
    '  params, ComparisonTable columns/rows) is written as literal data spelled out in full — strings, numbers,',
    '  true/false, null, arrays and objects, nested freely — and NOTHING else. Example:',
    '    <Tabs tabs={[{ label: "npm", value: "npm" }, { label: "pnpm", value: "pnpm" }]} defaultValue="npm" />',
    '  Inside a prop value, never an identifier or variable (prop={items}), never a property access, never a',
    '  function call (prop={getSteps()}), never a template literal, never JSX, never a spread ({...props} or',
    '  [...a, b]), never an operator or a comment. Never an event handler (onClick, onerror), never a class, id, or',
    '  data-* attribute starting with "dt-" or "data-docstube" (those names belong to docstube\'s own proof',
    '  components), and never MARKUP inside a value or a key — a "<" immediately followed by a letter or "/" is',
    '  rejected, in a plain string prop AND in any string nested inside literal data — so write a space after a',
    '  less-than sign ("a < b") and put any markup you want to SHOW in a code fence.',
    '  submit_page rejects every one of these outright.',
    '- Code examples must be complete and correct — they are compiled and executed.',
    '- If something cannot be known from the code (intent, history, "why"), use the `flag_question` tool to ask the',
    '  maintainers, then keep writing with what IS knowable. Never block on it; never invent the answer.',
    '',
    claimAuthorshipRules,
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
            'that was not flagged. Submit the complete corrected page (with its claim ledger) via submit_page.',
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
    `Page brief: ${input.node.brief}`,
    `Depth budget: ${input.node.depth}.`,
    `Primary audience: the "${input.node.primaryPersona}" persona — this page is written and reviewed for them.`,
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
    output: { type: 'mdx-ledger' }
  });
