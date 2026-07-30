import { z } from 'zod';
import type {
  AgentTaskSpec,
  BlockEntity,
  ClaimEvidence,
  ClaimLedger,
  Finding,
  IaPageNodeV2,
  PageEntity,
  RiskCriticFinding,
  RiskCriticResult,
  ToolDescriptor,
  Transcript
} from '@docstube/contracts';
import {
  agentTaskSpecSchema,
  blockIdSchema,
  claimIdSchema,
  hashValue,
  idPrefixes,
  mintId,
  riskCriticFindingKindSchema,
  riskCriticResultSchema,
  severitySchema
} from '@docstube/contracts';
import { blockSourceRanges } from '../entities/extract-entities.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { runRecordedTask } from './agent-task-record.ts';
import type { RunCostTracker } from './run-cost.ts';
import type { RiskCriticCache } from './risk-critic-cache.ts';

// THE EVIDENCE-FED RISK CRITIC (harness-state-v2 decision 4; PRODUCT §1.2 and §3.5 stage 6).
//
// It exists to kill plausibility-review theater. The dogfood evidence that motivated it was a
// persona review with ZERO tool calls marking correctness "met" because the claims were "plausible
// within the page itself" — a review that could not have been wrong, because it checked nothing.
// The fix is not a better reviewer prompt. It is to take correctness away from persona reviews
// entirely (they now judge audience fit and brief conformance), give the mechanical spine to the
// claim ledger, and hand the RESIDUE — the part neither can see — to exactly one critic that is
// given the evidence and nothing else.
//
// WHAT IT IS FED, AND WHAT IT IS DENIED. It receives the page prose, the claim ledger projected to
// what each claim ASSERTS and how strongly it is backed, the coverage linter's uncovered spans, and
// the page brief + primary persona. It is denied the repository and every repo tool. That denial is
// the whole design: giving a critic repo access is what turned persona reviews into theater, because
// a model with tools and a vague question spends its budget confirming plausibility instead of
// hunting risk. A critic that can only compare the prose against the evidence summary has exactly
// one useful thing to do — find where they disagree.
//
// IT IS NON-BLOCKING, ALWAYS (mirroring quality-ci-reader-v2 decision 21 for structural findings).
// Its output is committed work items: `refine` consumes them, the PR summary and the review UI show
// them, and they never fail a page, never enter the flag queue, never reach the deterministic gate,
// and never block auto-merge. A model's editorial opinion must not be able to withhold publication
// from a page whose claims all check out.
//
// ITS FINDINGS ARE ASSESSMENTS, NEVER CLAIMS. They live in provenance `assessments.riskCritic` —
// the separate editorial axis — and touch neither the claim ledger nor the correctness axis. A
// critic finding cannot make a claim contradicted, cannot make an unchecked claim checked, and
// cannot change the `complete` badge in either direction (see coverage-lint.ts and
// proof-projection.ts: the badge stays a deterministic computation).

// Bump when the prompt changes in a way that could change a verdict. It rides the cache key AND the
// committed record, so a stale cached verdict can never be mistaken for a current one.
export const riskCriticPromptVersion = '1';

const findingKinds = riskCriticFindingKindSchema.options;

// What each kind means, stated for the model in the same words the contract uses. The list is
// closed and design-derived (see provenance-v2-schema.ts): three from harness-state-v2 decision 4,
// one from PRODUCT §1.2's semantic assertion-coverage promise, two deferred here by
// quality-ci-reader-v2 decision 18 when the structural detectors shipped deterministic-only.
const kindGuidance: Record<(typeof findingKinds)[number], string> = {
  'misleading-framing':
    'the statements are individually defensible but the passage leads a reader to a false conclusion — ' +
    'a caveat stated too weakly, an edge case presented as the norm, a checked claim used to imply ' +
    'something broader than it says.',
  'dangerous-omission':
    'something a reader acting on this page needs to know is missing, and acting without it causes ' +
    'harm — data loss, a security hole, an irreversible operation, a cost. Absence of detail is not ' +
    'a dangerous omission; absence of a WARNING a reader would act differently for is.',
  'wrong-emphasis':
    'the page spends its weight in the wrong place for its stated brief and persona — a rare path ' +
    'documented at length while the common one is a footnote, or a contradicted/unchecked claim ' +
    'carrying the passage.',
  'unmarked-assertion':
    'prose that asserts a checkable fact about the code but carries no <Claim> marker AND was not ' +
    'caught by the deterministic linter — typically because it names no identifier or uses no ' +
    'assertion keyword ("the client gives up after a while", "this is usually fast enough"). Do NOT ' +
    'repeat spans the linter already listed; those are already counted.',
  'duplicate-coverage':
    'two differently-titled sections cover the same ground, so a reader cannot tell which is ' +
    'authoritative. Identical headings are already detected deterministically — report only the ' +
    'semantic case.',
  'misplaced-example':
    'a code example sits under a heading it does not illustrate, or illustrates a concept the ' +
    'section never introduces.'
};

// The model answers in ANCHOR-ID terms, so every finding is actionable by construction. Severity is
// advisory ordering, never a gate — 'error' here still ships the page.
const riskCriticOutputSchema = z.object({
  // REQUIRED, DELIBERATELY NOT DEFAULTED. With a `.default([])` an arbitrary payload — a refusal,
  // a prose apology serialized as an object, a schema the transport mangled — parses into "zero
  // findings" and is recorded as a COMPLETED CLEAN verdict. That is precisely the silent pass this
  // whole feature exists to eliminate. A response that does not contain a findings array is not a
  // verdict, and is recorded as a non-completion. An EXPLICIT empty array still means "clean page".
  findings: z.array(
    z.object({
      kind: riskCriticFindingKindSchema,
      // One of the block ids or claim ids listed in the prompt. Anything else is dropped.
      anchorId: z.string().min(1),
      severity: severitySchema,
      message: z.string().min(1),
      rationale: z.string().min(1)
    })
  )
});

export type RiskCriticInput = {
  mdx: string;
  page: PageEntity;
  ledger: ClaimLedger;
  claimEvidence: readonly ClaimEvidence[];
  node: IaPageNodeV2;
  personaDescription?: string | undefined;
};

const flattenBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

const EXCERPT_LIMIT = 600;

const truncate = (value: string, limit = EXCERPT_LIMIT): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;

// Block id → the MDX the block occupies. blockSourceRanges walks the SAME node set extraction does,
// in the same order, so index i is the i-th flattened block (the invariant claim anchoring relies
// on). A range the parser could not place degrades to an empty excerpt rather than a wrong one.
const blockExcerpts = (mdx: string, page: PageEntity): Map<string, string> => {
  const blocks = flattenBlocks(page);
  let ranges: Array<[number, number]>;
  try {
    ranges = blockSourceRanges(mdx);
  } catch {
    ranges = [];
  }
  const excerpts = new Map<string, string>();
  for (const [index, block] of blocks.entries()) {
    const range = ranges[index];
    const text = range === undefined ? '' : mdx.slice(range[0], range[1]).trim();
    excerpts.set(block.id, truncate(text));
  }
  return excerpts;
};

// The evidence kinds backing a claim, deduped — "what actually decided this?" in one token list.
// The critic needs the STRENGTH of the backing, not the payloads: a claim resting on a value
// predicate is load-bearing in a way an unchecked behavior claim is not.
const evidenceKinds = (record: ClaimEvidence | undefined): string =>
  record === undefined || record.evidence.length === 0
    ? 'none'
    : [...new Set(record.evidence.map((entry) => `${entry.ref.kind}:${entry.outcome}`))].toSorted().join(', ');

export type RiskCriticPromptInput = RiskCriticInput;

export const buildRiskCriticSystemPrompt = (): string =>
  [
    'You are a documentation RISK CRITIC. You are given one page, the ledger of the factual claims it',
    'marked, the evidence that decided each claim, and the spans a deterministic linter already flagged',
    'as unmarked assertions. You do NOT have the repository and you will not be given it.',
    '',
    'Your job is to find what mechanical claim checking structurally CANNOT catch. The claim ledger',
    'already proves or refutes individual facts; do not re-litigate it. Look at what the page does with',
    'those facts.',
    '',
    'Report a finding ONLY as one of these kinds:',
    ...findingKinds.map((kind) => `- ${kind}: ${kindGuidance[kind]}`),
    '',
    'RULES:',
    '- Every finding MUST carry `anchorId`: one of the block ids or claim ids listed in the page map.',
    '  A concern you cannot anchor to a listed id is one you must not report.',
    '- `rationale` must cite something concrete from the page text or the evidence summary. A rationale',
    '  a human cannot check against the material you were given is not a rationale.',
    '- Do NOT report a claim as wrong because you believe the underlying fact is wrong. You cannot see',
    "  the code. Correctness of individual facts is the ledger's job, not yours.",
    '- Do NOT restate spans already listed as linter-detected unmarked assertions; they are counted.',
    '- Do NOT report style, tone, grammar, formatting, or audience fit — a separate persona review owns',
    '  those, and duplicating them here is noise.',
    '- REPORTING NOTHING IS A CORRECT AND EXPECTED ANSWER. A page whose framing is honest, whose',
    '  omissions are not dangerous, and whose emphasis matches its brief yields an empty findings list.',
    '  Never manufacture a finding to appear thorough.',
    '- `severity` orders repair work: error = a reader would be actively misled or harmed; warning = a',
    '  real defect worth fixing; info = minor. Nothing you report blocks publication.'
  ].join('\n');

export const buildRiskCriticUserPrompt = (input: RiskCriticInput): string => {
  const excerpts = blockExcerpts(input.mdx, input.page);
  const evidenceByClaimId = new Map(input.claimEvidence.map((record) => [record.claimId, record]));
  const claimsByBlockId = new Map<string, typeof input.ledger.claims>();
  for (const claim of input.ledger.claims) {
    claimsByBlockId.set(claim.anchor.blockId, [...(claimsByBlockId.get(claim.anchor.blockId) ?? []), claim]);
  }
  const uncoveredByBlockId = new Map<string, string[]>();
  for (const span of input.ledger.coverageLint.uncovered) {
    uncoveredByBlockId.set(span.blockId, [...(uncoveredByBlockId.get(span.blockId) ?? []), span.excerpt]);
  }

  const sectionTitleByBlockId = new Map<string, string>();
  for (const section of input.page.sections) {
    for (const block of section.blocks) {
      sectionTitleByBlockId.set(block.id, section.title);
    }
  }

  const blockLines = flattenBlocks(input.page).flatMap((block) => {
    const claims = claimsByBlockId.get(block.id) ?? [];
    const uncovered = uncoveredByBlockId.get(block.id) ?? [];
    const section = sectionTitleByBlockId.get(block.id);
    return [
      `### block ${block.id} (${block.blockType}${section === undefined ? ', page preamble' : `, section "${section}"`})`,
      truncate(excerpts.get(block.id) ?? ''),
      ...(claims.length === 0
        ? []
        : [
            'claims anchored here:',
            ...claims.map((claim) => {
              const record = evidenceByClaimId.get(claim.claimId);
              return (
                `  - ${claim.claimId} [${claim.class}] ${record?.correctness ?? 'unchecked'}` +
                `${claim.disposition === null ? '' : ` (${claim.disposition})`}` +
                ` · evidence: ${evidenceKinds(record)}\n` +
                `    asserts: ${truncate(claim.predicate, 240)}\n` +
                `    visible text: ${truncate(claim.quote, 240)}`
              );
            })
          ]),
      ...(uncovered.length === 0
        ? []
        : [
            'linter-detected unmarked assertions in this block (already counted — do not repeat):',
            ...uncovered.map((excerpt) => `  - "${truncate(excerpt, 240)}"`)
          ]),
      ''
    ];
  });

  const totals = {
    total: input.ledger.claims.length,
    checked: input.claimEvidence.filter((record) => record.correctness === 'checked').length,
    contradicted: input.claimEvidence.filter((record) => record.correctness === 'contradicted').length,
    unchecked: input.claimEvidence.filter((record) => record.correctness === 'unchecked').length
  };

  return [
    `Page: "${input.page.title}" (slug: ${input.page.slug}, id: ${input.page.id})`,
    `Brief: ${input.node.brief}`,
    `Primary persona: ${input.node.primaryPersona}${
      input.personaDescription === undefined ? '' : ` — ${input.personaDescription}`
    }`,
    '',
    `Claim ledger: ${totals.total} claim(s) — ${totals.checked} checked, ${totals.contradicted} contradicted, ` +
      `${totals.unchecked} unchecked. Deterministic linter flagged ${input.ledger.coverageLint.uncovered.length} ` +
      'unmarked assertion(s).',
    '',
    '--- PAGE MAP (anchor every finding to one of these block or claim ids) ---',
    ...blockLines,
    '--- PAGE MDX START ---',
    input.mdx,
    '--- PAGE MDX END ---'
  ].join('\n');
};

export const buildAssessPageRiskTask = (input: RiskCriticInput): AgentTaskSpec =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'assess-page-risk',
    systemPrompt: buildRiskCriticSystemPrompt(),
    userPrompt: buildRiskCriticUserPrompt(input),
    // NO TOOLS, AND NO REPOSITORY (harness-state-v2 decision 4). The critic reasons over the
    // evidence summary it was handed; a critic that can read source is a second, worse, unbudgeted
    // verifier — and the exact failure mode that produced zero-tool-call plausibility reviews.
    tools: [],
    workspace: { readRoots: [], writableRoots: [] },
    budget: { maxTurns: 2, maxToolCalls: 1 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(riskCriticOutputSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

// THE COST KEY (mirroring the group assessor's, quality-ci-reader-v2 decision 7). One call per page,
// reusable across runs while nothing that could change the answer moved: the exact page prose, the
// ledger state the critic reasons FROM (per-claim assertion + correctness + evidence backing), the
// linter's uncovered spans, the brief/persona the judgement is relative to, the prompt version, and
// the model. A page whose prose and claims are unchanged must never re-bill.
//
// Deliberately NOT keyed on the run, the commit, or the locale: the critic reads prose and ledger
// state, so a no-op commit changes nothing it could see, and renditions are judged through their
// canonical source.
export const riskCriticCacheKey = (input: RiskCriticInput & { model: string }): string =>
  hashValue({
    critic: 'page-risk',
    promptVersion: riskCriticPromptVersion,
    model: input.model,
    // The page prose EXACTLY as the critic will read it.
    pageContent: input.mdx,
    brief: input.node.brief,
    primaryPersona: input.node.primaryPersona,
    personaDescription: input.personaDescription ?? '',
    ledgerState: input.ledger.claims
      .map((claim) => {
        const record = input.claimEvidence.find((entry) => entry.claimId === claim.claimId);
        return {
          claimId: claim.claimId,
          class: claim.class,
          predicate: claim.predicate,
          quote: claim.quote,
          blockId: claim.anchor.blockId,
          correctness: record?.correctness ?? 'unchecked',
          disposition: claim.disposition,
          evidence: evidenceKinds(record)
        };
      })
      .toSorted((left, right) => left.claimId.localeCompare(right.claimId)),
    uncovered: input.ledger.coverageLint.uncovered
      .map((span) => ({ blockId: span.blockId, excerpt: span.excerpt, detector: span.detector }))
      .toSorted((left, right) =>
        left.blockId === right.blockId
          ? left.excerpt.localeCompare(right.excerpt)
          : left.blockId.localeCompare(right.blockId)
      )
  });

export type RiskCriticParse = { findings: RiskCriticFinding[]; completed: boolean; warnings: string[] };

// LENIENT, EXACTLY LIKE THE REVIEW STAGE AND THE GROUP ASSESSOR. An unusable payload must not fail
// the run or the page: it becomes a recorded non-completion plus a warning, never a silent pass and
// never an exception. Findings that name an anchor the page does not have are DROPPED — a work item
// pointing at nothing is worse than no work item, and inventing an anchor to keep the finding would
// send `refine` at the wrong block.
export const riskCriticFromTranscript = (input: {
  transcript: Transcript;
  page: PageEntity;
  ledger: ClaimLedger;
}): RiskCriticParse => {
  if (input.transcript.result?.type !== 'structured') {
    return {
      findings: [],
      completed: false,
      warnings: [
        `the risk critic returned no structured verdict (stop: ${input.transcript.stopReason}); the page ships with the assessment recorded as not completed`
      ]
    };
  }
  const parsed = riskCriticOutputSchema.safeParse(input.transcript.result.value);
  if (!parsed.success) {
    return {
      findings: [],
      completed: false,
      warnings: [
        `the risk critic returned an unusable verdict (stop: ${input.transcript.stopReason}); the page ships with the assessment recorded as not completed`
      ]
    };
  }
  const blockIds = new Set(flattenBlocks(input.page).map((block) => block.id));
  const claimIds = new Set(input.ledger.claims.map((claim) => claim.claimId));
  const findings: RiskCriticFinding[] = [];
  const warnings: string[] = [];
  for (const entry of parsed.data.findings) {
    const isBlock = blockIdSchema.safeParse(entry.anchorId).success && blockIds.has(entry.anchorId);
    const isClaim = claimIdSchema.safeParse(entry.anchorId).success && claimIds.has(entry.anchorId);
    if (!isBlock && !isClaim) {
      warnings.push(
        `risk-critic finding (${entry.kind}) named anchor "${entry.anchorId}", which is not a block or claim on this page — dropped`
      );
      continue;
    }
    findings.push({
      kind: entry.kind,
      anchor: isBlock ? { kind: 'block', blockId: entry.anchorId } : { kind: 'claim', claimId: entry.anchorId },
      severity: entry.severity,
      message: entry.message,
      rationale: entry.rationale
    });
  }
  return { findings, completed: true, warnings };
};

// A critic that DID NOT RUN — no routable model, a frozen budget, or a transport that threw — is
// recorded as `pending`, never as a clean page (harness-state-v2 decision 3's rule for unrun
// reviews, applied here). The page still publishes; what is withheld is the assertion that anything
// was assessed.
export const pendingRiskCritic = (scoredBy: string): RiskCriticResult =>
  riskCriticResultSchema.parse({
    scoredBy,
    completion: 'pending',
    promptVersion: riskCriticPromptVersion,
    findings: []
  });

export const RISK_CRITIC_CHECK = 'risk-critic';

// Structurally identical to the page loop's TaskRunner, declared here rather than imported so this
// module never pulls in page-runner (which imports it).
export type RiskCriticTaskRunner = (
  spec: AgentTaskSpec,
  extraTools?: Array<{ descriptor: ToolDescriptor; handler: (args: unknown) => Promise<unknown> }>
) => Promise<Transcript>;

export type RunRiskCriticInput = {
  critic: RiskCriticInput;
  // The model the risk-critic role routes to. Undefined ⇒ the role cannot construct a transport,
  // so the assessment is recorded pending rather than skipped silently.
  model?: string | undefined;
  runTask?: RiskCriticTaskRunner | undefined;
  journal?: RunJournal | undefined;
  costTracker?: RunCostTracker | undefined;
  cache?: RiskCriticCache | undefined;
  pageId?: string | undefined;
};

export type RunRiskCriticResult = {
  result: RiskCriticResult;
  warnings: string[];
  // True when this call actually reached a transport — the cost-discipline assertion.
  requested: boolean;
  fromCache: boolean;
};

// THE ONE CALL PER PAGE, WITH HONEST DEGRADATION.
//
// Order of outcomes, and why each is what it is:
//   no runner / no routable model → pending. The role could not construct a transport; saying
//     "assessed, nothing found" would be a lie about work that never happened.
//   cache hit                     → completed, no transport touched, nothing re-billed. A page
//     whose prose and claims are unchanged must not pay twice.
//   budget frozen                 → pending. Same rule the page loop and structure pass follow:
//     freezing costs the assessment, never the publication (harness-state-v2 decision 3).
//   transport threw               → pending, warning journaled. A model failure must not fail the
//     page, and must not be recorded as a clean verdict either.
//   ran, unusable payload         → failed (the persona-review precedent for a broken reviewer).
//   ran, usable payload           → completed, findings cached.
export const runRiskCritic = async (input: RunRiskCriticInput): Promise<RunRiskCriticResult> => {
  const { model, runTask } = input;
  if (runTask === undefined || model === undefined) {
    return {
      result: pendingRiskCritic(model ?? 'unrouted'),
      warnings:
        model === undefined
          ? ['the risk-critic role resolved no model, so no page risk assessment ran; recorded pending']
          : [],
      requested: false,
      fromCache: false
    };
  }
  const key = riskCriticCacheKey({ ...input.critic, model });
  const cached = await input.cache?.read(key);
  if (cached !== undefined) {
    return {
      result: riskCriticResultSchema.parse({
        scoredBy: model,
        completion: 'completed',
        promptVersion: riskCriticPromptVersion,
        findings: cached
      }),
      warnings: [],
      requested: false,
      fromCache: true
    };
  }
  if (input.costTracker?.shouldFreeze() === true) {
    return {
      result: pendingRiskCritic(model),
      warnings: ['the run budget froze before this page could be risk-assessed; recorded pending'],
      requested: false,
      fromCache: false
    };
  }
  const task = buildAssessPageRiskTask(input.critic);
  let transcript: Transcript;
  try {
    transcript =
      input.journal === undefined
        ? await runTask(task)
        : await runRecordedTask({
            runTask,
            journal: input.journal,
            task,
            ...(input.costTracker === undefined ? {} : { costTracker: input.costTracker }),
            ...(input.pageId === undefined ? {} : { pageId: input.pageId })
          });
  } catch (error) {
    return {
      result: pendingRiskCritic(model),
      warnings: [
        `the risk critic could not run (${error instanceof Error ? error.message : String(error)}); recorded pending and the page still publishes`
      ],
      requested: true,
      fromCache: false
    };
  }
  const parsed = riskCriticFromTranscript({ transcript, page: input.critic.page, ledger: input.critic.ledger });
  if (!parsed.completed) {
    return {
      result: riskCriticResultSchema.parse({
        scoredBy: transcript.model,
        completion: 'failed',
        promptVersion: riskCriticPromptVersion,
        findings: []
      }),
      warnings: parsed.warnings,
      requested: true,
      fromCache: false
    };
  }
  // Only completed verdicts are cached — see risk-critic-cache.ts.
  await input.cache?.write({ key, model, findings: parsed.findings });
  return {
    result: riskCriticResultSchema.parse({
      scoredBy: transcript.model,
      completion: 'completed',
      promptVersion: riskCriticPromptVersion,
      findings: parsed.findings
    }),
    warnings: parsed.warnings,
    requested: true,
    fromCache: false
  };
};

// The journal/PR/UI projection of critic findings. INFO OR WARNING, NEVER ERROR: `error` findings
// are what the deterministic gate consumes, so emitting one here would make an editorial opinion
// block a page. A critic finding whose own severity is 'error' still reports as a warning — its
// severity survives in `data` for ordering.
export const riskCriticFindings = (result: RiskCriticResult): Finding[] =>
  result.findings.map((finding) => ({
    source: 'review' as const,
    check: RISK_CRITIC_CHECK,
    severity: finding.severity === 'info' ? ('info' as const) : ('warning' as const),
    message: `[${finding.kind}] ${finding.message} — ${finding.rationale}`,
    data: {
      kind: finding.kind,
      anchor: finding.anchor,
      criticSeverity: finding.severity
    }
  }));

// The one line the PR summary and the dashboard render. It always says nonblocking, and it always
// states the DETERMINISTIC linter count next to the critic's semantic count (PRODUCT §1.2): the
// linter is the floor that gates the badge, the critic is the semantic layer on top that does not.
// Showing either number alone is how a reader concludes the wrong thing about coverage.
export const riskCriticSummaryLine = (input: {
  result: RiskCriticResult | undefined;
  uncoveredAssertions: number;
}): string => {
  const floor = `${input.uncoveredAssertions} unmarked assertion(s) detected deterministically (gates the complete badge)`;
  if (input.result === undefined) {
    return `Risk critic: not run · ${floor}`;
  }
  if (input.result.completion !== 'completed') {
    return `Risk critic: ${input.result.completion} — no verdict this run · ${floor}`;
  }
  const semantic = input.result.findings.filter((finding) => finding.kind === 'unmarked-assertion').length;
  return (
    `Risk critic: ${input.result.findings.length} finding(s) · nonblocking · ` +
    `${semantic} additional assertion(s) the linter cannot see · ${floor}`
  );
};
