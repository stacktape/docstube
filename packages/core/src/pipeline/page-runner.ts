import type { PageArtifact } from '@docstube/plugin-sdk';
import type {
  Codemap,
  Finding,
  IaNode,
  PageShard,
  ReviewResult,
  ToolDescriptor,
  Transcript
} from '@docstube/contracts';
import { hashValue, idPrefixes, mintId } from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import type { ConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { matchEntityIds } from '../entities/match-entities.ts';
import type { PluginHost } from '../plugins/plugin-host.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { assignGuarantees, errorFindings, liftClaimGroundedBlocks, runVerifiers } from './verify-page.ts';
import { buildWritePageTask } from './write-page.ts';
import { reviewPage } from './review-page.ts';
import { attachExtractedClaims } from './claims-stage.ts';
import { createQuestionCollector, flagQuestionDescriptor, questionsToFlags } from './tribal-knowledge.ts';
import type { KnowledgeEntry, OpenQuestions } from './tribal-knowledge.ts';
import type { RunCostTracker } from './run-cost.ts';

// The per-page generation loop: write ⇄ (review ∥ verify) → gate, bounded retries, flag instead
// of silent shipping. Reused by generate (all pages) and maintain/refresh (affected pages only).
//
// Cost accounting: every task-completed usage feeds ctx.costTracker, but the cap-freeze check
// deliberately does NOT happen inside this loop — only the callers check, between pages. Freezing
// mid-loop would abandon a half-verified draft: the shard and MDX would ship in a state the gate
// never approved, which is state corruption, not savings.

// Structurally compatible with agent-runtime's ToolImplementation; core stays contracts-typed.
export type TaskToolImplementation = {
  descriptor: ToolDescriptor;
  handler: (args: unknown) => Promise<unknown>;
};

export type TaskRunner = (spec: AgentTaskSpec, extraTools?: TaskToolImplementation[]) => Promise<Transcript>;

export type PageRunOptions = {
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  maxAttemptsPerPage?: number | undefined;
};

export type PageRunContext = {
  repoRoot: string;
  host: PluginHost;
  codemap: Codemap;
  journal: RunJournal;
  options: PageRunOptions;
  config: ConfigFamily['config'];
  glossary: ConfigFamily['glossary'];
  criteria: string[];
  instructions: string[];
  // Answered tribal knowledge, injected into every writer prompt; keys drive ask-once dedup.
  knowledge: KnowledgeEntry[];
  openQuestions: OpenQuestions;
  // Accumulates every task's reported cost; callers check shouldFreeze() between pages.
  costTracker: RunCostTracker;
  commit: string;
  locale: string;
  version: string;
};

export type PageOutcome = {
  pageId: string;
  slug: string;
  status: 'passed' | 'flagged';
  findings: Finding[];
  attempts: number;
};

// Writers occasionally wrap the whole page in a fence despite instructions; unwrap deterministically.
export const unwrapMdxFence = (output: string): string => {
  const match = output.trim().match(/^```(?:mdx|markdown|md)?\n([\s\S]*)\n```$/);
  return match?.[1] ?? output;
};

export const contentRelativePath = (locale: string, slug: string): string => `content/${locale}/${slug}.mdx`;

export const generatePage = async (
  ctx: PageRunContext,
  node: IaNode,
  previousShard: PageShard | undefined
): Promise<{ outcome: PageOutcome; artifact: PageArtifact; shard: PageShard }> => {
  const maxAttempts = ctx.options.maxAttemptsPerPage ?? 3;
  let findings: Finding[] = [];
  let lastArtifact: PageArtifact | undefined;
  let lastTranscript: Transcript | undefined;
  let lastReviews: ReviewResult[] = [];
  let attemptsUsed = 0;
  // One collector across attempts: retries re-asking the same question stay a single flag.
  const questionCollector = createQuestionCollector();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    const task = buildWritePageTask({
      config: ctx.config,
      glossary: ctx.glossary,
      codemap: ctx.codemap,
      node,
      priorFindings: findings,
      enabledComponents: ctx.config.components,
      instructions: ctx.instructions,
      knowledge: ctx.knowledge,
      toolDescriptors: [...ctx.options.toolDescriptors, flagQuestionDescriptor]
    });
    await ctx.journal.append({ type: 'task-started', taskId: task.id });
    const transcript = await ctx.options.runTask(task, [questionCollector.tool]);
    await ctx.journal.append({ type: 'task-completed', taskId: task.id, usage: transcript.usage });
    ctx.costTracker.add(transcript.usage);
    lastTranscript = transcript;
    if (transcript.result?.type !== 'mdx') {
      throw new CoreError(
        'pipeline-failed',
        `write-page task for "${node.slug}" returned no MDX (stop: ${transcript.stopReason})`
      );
    }
    const mdx = unwrapMdxFence(transcript.result.mdx);

    let page = extractPageEntity({ mdx, slug: node.slug, fallbackTitle: node.title });
    if (previousShard) {
      page = matchEntityIds(page, previousShard.page).page;
    }
    // Page-level source attribution: the symbols living in files the writer actually read.
    // Claim-level attribution is a later stage; this grounds coverage and refresh scoping now.
    const readFiles = new Set(transcript.observedReads.map((read) => read.file));
    const sources = ctx.codemap.symbols
      .filter((symbol) => readFiles.has(symbol.file))
      .map((symbol) => ({ symbol: symbol.hash, file: symbol.file, span: symbol.span, commit: ctx.commit }));
    page = {
      ...page,
      provenance: {
        ...page.provenance,
        sources,
        seedContext: [
          `ctx:codemap:${hashValue(ctx.codemap.symbols.map((symbol) => symbol.hash))}`,
          `ctx:brief:${hashValue(node)}`
        ],
        observedReads: transcript.observedReads
      }
    };

    const artifact: PageArtifact = {
      page,
      mdx,
      mdxPath: contentRelativePath(ctx.locale, node.slug),
      locale: ctx.locale,
      version: ctx.version
    };

    // Verify (deterministic) and review (per-persona, explainable criteria) both gate the draft.
    await ctx.journal.append({ type: 'page-status', pageId: page.id, status: 'checking' });
    const results = await runVerifiers({
      repoRoot: ctx.repoRoot,
      config: ctx.config,
      codemap: ctx.codemap,
      glossary: ctx.glossary,
      host: ctx.host,
      artifacts: [artifact],
      includeSiteScope: false
    });
    await ctx.journal.append({ type: 'page-status', pageId: page.id, status: 'judging' });
    const reviews = await reviewPage({
      config: ctx.config,
      criteria: ctx.criteria,
      artifact,
      runTask: ctx.options.runTask,
      journal: ctx.journal,
      costTracker: ctx.costTracker
    });
    lastReviews = reviews;
    findings = [
      ...errorFindings(results),
      ...reviews.flatMap((review) => review.findings.filter((finding) => finding.severity === 'error'))
    ];
    if (findings.length > 0) {
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings });
    }
    const verifiedPage = assignGuarantees(page, results, ctx.host);
    lastArtifact = { ...artifact, page: verifiedPage };
    if (findings.length === 0) {
      // Claims stage on the passing path only: extract checkable claims (same machinery as
      // `audit`), ground them against the codemap, and gate on stale references like any other
      // error finding. One agent call per shipped page, cache-keyed by content.
      const claimsResult = await attachExtractedClaims({
        artifact: { ...artifact, page: verifiedPage },
        codemap: ctx.codemap,
        runTask: ctx.options.runTask,
        journal: ctx.journal,
        costTracker: ctx.costTracker
      });
      findings = claimsResult.findings;
      if (claimsResult.warning !== undefined) {
        await ctx.journal.append({
          type: 'findings',
          pageId: page.id,
          findings: [
            { source: 'verifier', check: 'claim-extraction', severity: 'warning', message: claimsResult.warning }
          ]
        });
      }
      if (findings.length === 0) {
        // Grounded claims lift their prose blocks to proven, then rolls-ups recompute — this must
        // run AFTER the claims stage (assignGuarantees ran before claims existed).
        lastArtifact = { ...artifact, page: liftClaimGroundedBlocks(claimsResult.page) };
        break;
      }
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings });
    }
    if (attempt < maxAttempts) {
      await ctx.journal.append({ type: 'page-status', pageId: page.id, status: 'retrying' });
      await ctx.journal.append({ type: 'retry-scheduled', pageId: page.id, attempt: attempt + 1, maxAttempts });
    }
  }

  if (lastArtifact === undefined || lastTranscript === undefined) {
    throw new CoreError('pipeline-failed', `page "${node.slug}" produced no artifact`);
  }

  // The committed manifest explains every badge: the shipped page carries compact verdicts from
  // the reviews that scored it (reasoning prose stays in the run journal).
  const reviewRecords = lastReviews.map((review) => ({
    persona: review.persona,
    criteria: review.criteria.map((criterion) => ({ criterion: criterion.criterion, outcome: criterion.outcome })),
    runId: ctx.journal.runId,
    at: new Date().toISOString()
  }));
  lastArtifact = {
    ...lastArtifact,
    page: {
      ...lastArtifact.page,
      provenance: { ...lastArtifact.page.provenance, reviews: reviewRecords }
    }
  };

  // Flags travel with the shard: regeneration rebuilds the shard, so tribal-knowledge flags (the
  // durable Q&A trail) are carried forward verbatim. Other kinds are NOT carried — the page was
  // just re-verified, so a stale verification flag is superseded (re-raised below if still true).
  const carriedFlags = (previousShard?.flags ?? []).filter((flag) => flag.kind === 'tribal-knowledge');

  // Tribal knowledge: writer questions become flags — non-blocking (the page still ships),
  // ask-once (deduped against every open flag and every stored answer).
  const questionFlags = questionsToFlags({
    questions: questionCollector.questions(),
    codemap: ctx.codemap,
    knowledgeKeys: new Set(ctx.knowledge.map((entry) => entry.key)),
    openQuestions: ctx.openQuestions,
    shard: { locale: ctx.locale, version: ctx.version },
    pageId: lastArtifact.page.id,
    runId: ctx.journal.runId
  });

  // Gate: clean → passed; findings after bounded retries → flag and ship the flagged state.
  // Never silently wrong (PRODUCT §3.5 stage 6).
  const passed = findings.length === 0;
  const shard: PageShard = {
    schemaVersion: 1,
    locale: ctx.locale,
    version: ctx.version,
    sourceCommit: ctx.commit,
    generatedAt: new Date().toISOString(),
    page: lastArtifact.page,
    flags: passed
      ? [...carriedFlags, ...questionFlags]
      : [
          ...carriedFlags,
          ...questionFlags,
          {
            id: mintId(idPrefixes.flag),
            kind: 'system',
            status: 'open',
            summary: `verification kept failing after retries on "${node.slug}"`,
            detail: findings.map((finding) => `[${finding.check}] ${finding.message}`).join('\n'),
            entity: { version: ctx.version, locale: ctx.locale, pageId: lastArtifact.page.id },
            runId: ctx.journal.runId,
            createdAt: new Date().toISOString()
          }
        ]
  };
  return {
    outcome: {
      pageId: lastArtifact.page.id,
      slug: node.slug,
      status: passed ? 'passed' : 'flagged',
      findings,
      attempts: attemptsUsed
    },
    artifact: lastArtifact,
    shard
  };
};
