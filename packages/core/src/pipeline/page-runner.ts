import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageArtifact } from '@docstube/plugin-sdk';
import { createSubmitPageTool, submitPageDescriptor } from '@docstube/agent-runtime';
import type {
  ClaimLedger,
  ClaimMatching,
  Codemap,
  Finding,
  FingerprintSnapshot,
  IaPageNodeV2,
  PageShard,
  ProvenanceV2,
  ToolDescriptor,
  Transcript
} from '@docstube/contracts';
import { hashValue, idPrefixes, mintId } from '@docstube/contracts';
import type { AgentTaskSpec } from '@docstube/contracts';
import type { ConfigFamily } from '../config/config-io.ts';
import { CoreError } from '../errors.ts';
import { extractPageEntity } from '../entities/extract-entities.ts';
import { matchEntityIds } from '../entities/match-entities.ts';
import type { BlockMatchConfidence } from '../entities/match-entities.ts';
import type { PluginHost } from '../plugins/plugin-host.ts';
import type { RunJournal } from '../state/run-journal.ts';
import { errorFindings, runVerifiers } from './verify-page.ts';
import { buildWritePageTask } from './write-page.ts';
import { reviewPage } from './review-page.ts';
import type { ScoredReview } from './review-page.ts';
import { assembleProvenanceV2 } from './assemble-provenance.ts';
import { anchorWriterLedger } from './anchor-ledger.ts';
import { matchClaimIds } from './match-claims.ts';
import { CLAIM_VERIFICATION_CHECK, verifyClaims } from './verify-claims.ts';
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
  // The typed-fingerprint snapshot claim subscriptions resolve against (ARCHITECTURE §7.2).
  fingerprints: FingerprintSnapshot;
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
  // True when HEAD may never have contained the working-tree bytes this run read (dirty tree or
  // no HEAD) — persisted on GenerationLineage so evidence labeling stays honest (finding 7).
  dirtyWorkingTree: boolean;
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
  // The page's ia.yml v2 record (converted at pipeline entry): title, brief, depth, and the
  // primary persona whose review gates this page.
  node: IaPageNodeV2,
  previousShard: PageShard | undefined
): Promise<{
  outcome: PageOutcome;
  artifact: PageArtifact;
  shard: PageShard;
  ledger?: ClaimLedger;
  // The final attempt's ProvenanceV2 (also embedded on the shard).
  provenance?: ProvenanceV2;
  // True when the candidate was REJECTED after retry exhaustion and the previously published page
  // was retained byte-for-byte (impl-06 finding 3; anticipates staged-atomic publish).
  retainedPrior?: boolean;
}> => {
  // Clamped to at least one attempt — a non-positive cap would skip the loop entirely and crash
  // below with a misleading 'produced no artifact'.
  const maxAttempts = Math.max(1, ctx.options.maxAttemptsPerPage ?? 3);
  let findings: Finding[] = [];
  let priorDraft: string | undefined;
  let attemptsUsed = 0;
  // ONE attempt-local candidate (impl-07 finding 3): artifact, ledger, provenance, matching,
  // reviews, findings, and transcript are created together per attempt and replaced together.
  // Persistence reads ONLY this final coherent candidate — an attempt that fails before
  // verification carries NO ledger/provenance/matching, so a later attempt's MDX can never ship
  // under an earlier attempt's trust state.
  type AttemptCandidate = {
    attempt: number;
    artifact: PageArtifact;
    transcript: Transcript;
    findings: Finding[];
    reviews: ScoredReview[];
    ledger?: ClaimLedger;
    provenance?: ProvenanceV2;
    matching?: ClaimMatching;
  };
  let candidate: AttemptCandidate | undefined;
  // One collector across attempts: retries re-asking the same question stay a single flag.
  const questionCollector = createQuestionCollector();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    // Fresh per attempt: a retry must not inherit the previous attempt's accepted submission.
    const submitPage = createSubmitPageTool();
    const task = buildWritePageTask({
      config: ctx.config,
      glossary: ctx.glossary,
      codemap: ctx.codemap,
      node,
      priorFindings: findings,
      priorDraft,
      enabledComponents: ctx.config.components,
      instructions: ctx.instructions,
      knowledge: ctx.knowledge,
      toolDescriptors: [...ctx.options.toolDescriptors, submitPageDescriptor, flagQuestionDescriptor]
    });
    await ctx.journal.append({ type: 'task-started', taskId: task.id });
    const transcript = await ctx.options.runTask(task, [submitPage.tool, questionCollector.tool]);
    await ctx.journal.append({ type: 'task-completed', taskId: task.id, usage: transcript.usage });
    ctx.costTracker.add(transcript.usage);
    if (transcript.result?.type !== 'mdx-ledger') {
      throw new CoreError(
        'pipeline-failed',
        `write-page task for "${node.slug}" returned no accepted submission (stop: ${transcript.stopReason})`
      );
    }
    const writerLedger = transcript.result.ledger;
    const mdx = unwrapMdxFence(transcript.result.mdx);
    // On retry the writer edits THIS draft (with the findings attached), not a fresh rewrite.
    priorDraft = mdx;

    let page = extractPageEntity({ mdx, slug: node.slug, fallbackTitle: node.title });
    // Carried block id → thread confidence; claim matching refuses 'exact' over inexact threads.
    let blockConfidence: ReadonlyMap<string, BlockMatchConfidence> = new Map();
    if (previousShard) {
      const matchedPage = matchEntityIds(page, previousShard.page);
      page = matchedPage.page;
      blockConfidence = matchedPage.blockConfidence;
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

    // Fresh candidate for THIS attempt — replaces the previous attempt's candidate wholesale.
    const attemptCandidate: AttemptCandidate = { attempt, artifact, transcript, findings: [], reviews: [] };
    candidate = attemptCandidate;
    const scheduleRetry = async (): Promise<void> => {
      if (attempt < maxAttempts) {
        await ctx.journal.append({ type: 'page-status', pageId: page.id, status: 'retrying' });
        await ctx.journal.append({ type: 'retry-scheduled', pageId: page.id, attempt: attempt + 1, maxAttempts });
      }
    };

    // KERNEL ANCHORING RUNS FIRST — before deterministic verification and reviews (impl-06
    // finding 2): the accepted writer ledger becomes the committed kernel ledger (marker → block
    // anchors, minted claim ids, subscriptions resolved against the fingerprint snapshot), so the
    // later stages can bind evidence to CLAIMS, and a draft whose ledger cannot anchor never
    // burns expensive review calls. The post-hoc claim extractor is gone from this path — it
    // survives only inside `docstube audit` for foreign docs.
    await ctx.journal.append({ type: 'page-status', pageId: page.id, status: 'checking' });
    const anchoredLedger = anchorWriterLedger({
      mdx,
      writerLedger,
      page,
      fingerprints: ctx.fingerprints,
      codemap: ctx.codemap,
      observedReads: transcript.observedReads,
      commit: ctx.commit
    });
    if (anchoredLedger.warnings.length > 0) {
      const claimWarnings: Finding[] = anchoredLedger.warnings.map((warning) => ({
        source: 'verifier',
        check: 'claim-anchoring',
        severity: 'warning',
        message: warning
      }));
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings: claimWarnings });
    }
    if (!anchoredLedger.ok) {
      // Fail-closed anchoring (PRODUCT §3.3/§3.5): a claim that cannot anchor NEVER produces a
      // passing ledger with fewer claims. Kernel invariant breaches (the accepted MDX no longer
      // matches what submit_page validated) abort the run; writer-repairable errors feed the
      // bounded retry loop with the precise error, exactly like verifier findings.
      const kernelErrors = anchoredLedger.errors.filter((issue) => issue.kernel);
      if (kernelErrors.length > 0) {
        throw new CoreError(
          'pipeline-failed',
          `claim anchoring on "${node.slug}" hit a kernel invariant breach: ${kernelErrors
            .map((issue) => issue.message)
            .join('; ')}`
        );
      }
      findings = anchoredLedger.errors.map((issue) => ({
        source: 'verifier',
        check: 'claim-anchoring',
        severity: 'error',
        message: issue.message
      }));
      // The candidate stays ledger-less: this attempt never reached a committed trust state, so
      // nothing from any other attempt may pair with its MDX (impl-07 finding 3).
      attemptCandidate.findings = findings;
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings });
      await scheduleRetry();
      continue;
    }
    // Claim identity matching (trust-model-v2 decision 8): a continuing assertion on a matched
    // block reuses the previous kernel ledger's claim id — identity carries, while predicate,
    // anchor, subscriptions, evidence, and trust state all come from the CURRENT ledger.
    const matched = matchClaimIds({
      ledger: anchoredLedger.ledger,
      anchored: anchoredLedger.anchored,
      previousLedger: previousShard?.ledger,
      blockConfidence
    });
    attemptCandidate.matching = matched.matching;
    // Ambiguous threads (drift markers) and orphaned prior claims are recorded facts, never
    // silent: they ride the journal and the shard's claimMatching records.
    const matchingWarnings: Finding[] = [
      ...matched.matches
        .filter((match) => match.confidence === 'ambiguous')
        .map((match) => ({
          source: 'verifier' as const,
          check: 'claim-matching',
          severity: 'warning' as const,
          message: `claim ${match.priorId} threaded ambiguously (${match.drift.join(', ')}) — content changed substantially since its human threads were written; drift marker recorded`,
          data: { priorId: match.priorId, confidence: match.confidence, drift: match.drift }
        })),
      ...matched.orphans.map((orphanId) => ({
        source: 'verifier' as const,
        check: 'claim-matching',
        severity: 'warning' as const,
        message: `previous claim ${orphanId} matched nothing in the regenerated page — its threads are orphaned for re-attachment or dismissal`,
        data: { orphanId }
      }))
    ];
    if (matchingWarnings.length > 0) {
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings: matchingWarnings });
    }

    // Deterministic verifiers and persona review both gate the draft. They run AFTER anchoring:
    // snippet execution results carry the covers= marker ids claim verification consumes.
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
      primaryPersona: node.primaryPersona,
      brief: node.brief,
      runTask: ctx.options.runTask,
      toolDescriptors: ctx.options.toolDescriptors,
      journal: ctx.journal,
      costTracker: ctx.costTracker
    });
    attemptCandidate.reviews = reviews;
    // Review warnings never gate, but they must be visible: a skipped persona review (invalid
    // reviewer output) surfaces only here — filtering errors alone would swallow it silently.
    const reviewWarnings = reviews.flatMap((review) =>
      review.findings.filter((finding) => finding.severity === 'warning')
    );
    if (reviewWarnings.length > 0) {
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings: reviewWarnings });
    }
    // Claim verification: the authority table assigns correctness per claim by minting canonical
    // EvidenceRecords (codemap grounding, the minimal value-predicate verifier, declared
    // execution coverage). It runs on EVERY anchored attempt — including the final failing one —
    // so the persisted artifact always carries its true final ledger/evidence state (impl-06
    // finding 3: the lastLedger/lastProvenance assignment bug). Contradictions, grounding
    // failures, and value-binding violations are BLOCKING error findings on the same bounded
    // retry path as verifier findings.
    const verified = await verifyClaims({
      ledger: matched.ledger,
      anchored: matched.anchored,
      page,
      anchorEvidence: anchoredLedger.evidence,
      rejectedProposals: anchoredLedger.rejectedProposals,
      codemap: ctx.codemap,
      packs: ctx.host.languagePacks().map((entry) => entry.definition),
      repoRoot: ctx.repoRoot,
      fingerprints: ctx.fingerprints,
      verifierResults: results,
      commit: ctx.commit
    });
    if (verified.warnings.length > 0) {
      await ctx.journal.append({
        type: 'findings',
        pageId: page.id,
        findings: verified.warnings.map((warning) => ({
          source: 'verifier' as const,
          check: CLAIM_VERIFICATION_CHECK,
          severity: 'warning' as const,
          message: warning
        }))
      });
    }
    findings = [
      ...errorFindings(results),
      ...reviews.flatMap((review) => review.findings.filter((finding) => finding.severity === 'error')),
      ...verified.findings
    ];
    attemptCandidate.findings = findings;
    attemptCandidate.ledger = verified.ledger;
    // Provenance v2: lineage / dependencies / claimEvidence / assessments, validated by parse.
    // Assembled on every anchored attempt so the candidate always carries its OWN final state.
    attemptCandidate.provenance = assembleProvenanceV2({
      pageId: page.id,
      page,
      node,
      ledger: verified.ledger,
      claimEvidence: verified.claimEvidence,
      dirtyWorkingTree: ctx.dirtyWorkingTree,
      transcript,
      writeTask: task,
      reviews,
      instructions: ctx.instructions,
      criteria: ctx.criteria,
      glossary: ctx.glossary,
      config: ctx.config,
      knowledge: ctx.knowledge
    });
    if (findings.length > 0) {
      await ctx.journal.append({ type: 'findings', pageId: page.id, findings });
      await scheduleRetry();
      continue;
    }
    break;
  }

  if (candidate === undefined) {
    throw new CoreError('pipeline-failed', `page "${node.slug}" produced no artifact`);
  }

  // The committed manifest explains every badge: the shipped page carries compact verdicts from
  // the reviews of the FINAL candidate's own attempt (reasoning prose stays in the run journal).
  const reviewRecords = candidate.reviews.map((review) => ({
    persona: review.persona,
    criteria: review.criteria.map((criterion) => ({ criterion: criterion.criterion, outcome: criterion.outcome })),
    runId: ctx.journal.runId,
    at: new Date().toISOString()
  }));
  const finalArtifact: PageArtifact = {
    ...candidate.artifact,
    page: {
      ...candidate.artifact.page,
      provenance: { ...candidate.artifact.page.provenance, reviews: reviewRecords }
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
    pageId: finalArtifact.page.id,
    runId: ctx.journal.runId
  });

  // Gate: clean → passed; findings after bounded retries → flag and ship the flagged state.
  // Never silently wrong (PRODUCT §3.5 stage 6). Read from the final candidate — the single
  // source of attempt-consistent state.
  const finalFindings = candidate.findings;
  const passed = finalFindings.length === 0;

  // FAILED-ATTEMPT PUBLICATION ROUTE (impl-06 finding 3, anticipating pipeline-v2 staged-atomic
  // publish): when the final retry still carries blocking CLAIM findings (a contradiction, a
  // value-binding violation, an unanchorable ledger) and a previously published page exists, the
  // candidate is DISCARDED and the prior page is retained byte-for-byte — its shard (page,
  // ledger, evidence, matching) carries forward unchanged, with an open flag referencing the
  // rejected candidate attempt. Publishing prose whose claims the kernel just refuted would be
  // shipping a known lie under a clean layout.
  const claimFindings = finalFindings.filter(
    (finding) => finding.check === CLAIM_VERIFICATION_CHECK || finding.check === 'claim-anchoring'
  );
  if (!passed && claimFindings.length > 0 && previousShard !== undefined) {
    const priorMdxPath = join(ctx.repoRoot, ctx.config.outDir, contentRelativePath(ctx.locale, node.slug));
    let priorMdx: string | undefined;
    try {
      priorMdx = await readFile(priorMdxPath, 'utf8');
    } catch {
      priorMdx = undefined;
    }
    if (priorMdx !== undefined) {
      const rejectionFlag = {
        id: mintId(idPrefixes.flag),
        kind: 'system' as const,
        status: 'open' as const,
        summary: `regeneration of "${node.slug}" rejected — claim verification failed; previous published page retained`,
        detail: [
          `the candidate from run ${ctx.journal.runId} (${attemptsUsed} attempt(s)) was discarded:`,
          ...finalFindings.map((finding) => `[${finding.check}] ${finding.message}`)
        ].join('\n'),
        entity: { version: ctx.version, locale: ctx.locale, pageId: previousShard.page.id },
        runId: ctx.journal.runId,
        createdAt: new Date().toISOString()
      };
      // Callers journal flag-raised when they persist the shard (as for every other flag).
      return {
        outcome: {
          pageId: previousShard.page.id,
          slug: node.slug,
          status: 'flagged',
          findings: finalFindings,
          attempts: attemptsUsed
        },
        artifact: {
          page: previousShard.page,
          mdx: priorMdx,
          mdxPath: contentRelativePath(ctx.locale, node.slug),
          locale: ctx.locale,
          version: ctx.version
        },
        // The prior shard byte-for-byte, plus the rejection flag and any new writer questions.
        shard: { ...previousShard, flags: [...previousShard.flags, ...questionFlags, rejectionFlag] },
        ...(previousShard.ledger === undefined ? {} : { ledger: previousShard.ledger }),
        ...(previousShard.provenance === undefined ? {} : { provenance: previousShard.provenance }),
        retainedPrior: true
      };
    }
  }

  // The shard embeds the trust spine of the FINAL candidate — kernel ledger, ProvenanceV2
  // (ClaimEvidence), and the claim-matching records — as one attempt-consistent unit: on a first
  // generation with no prior page, a contradicted claim persists AS contradicted, loud and
  // machine-readable; a final attempt that failed before verification persists with NO trust
  // spine at all, never with an earlier attempt's (impl-07 finding 3).
  const shard: PageShard = {
    schemaVersion: 2,
    locale: ctx.locale,
    version: ctx.version,
    sourceCommit: ctx.commit,
    generatedAt: new Date().toISOString(),
    page: finalArtifact.page,
    ...(candidate.ledger === undefined || candidate.provenance === undefined
      ? {}
      : { ledger: candidate.ledger, provenance: candidate.provenance }),
    ...(candidate.ledger === undefined || candidate.matching === undefined
      ? {}
      : { claimMatching: candidate.matching }),
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
            detail: finalFindings.map((finding) => `[${finding.check}] ${finding.message}`).join('\n'),
            entity: { version: ctx.version, locale: ctx.locale, pageId: finalArtifact.page.id },
            runId: ctx.journal.runId,
            createdAt: new Date().toISOString()
          }
        ]
  };
  return {
    outcome: {
      pageId: finalArtifact.page.id,
      slug: node.slug,
      status: passed ? 'passed' : 'flagged',
      findings: finalFindings,
      attempts: attemptsUsed
    },
    artifact: finalArtifact,
    shard,
    // The committed kernel ledger and its provenance v2 for the shipped page (undefined when the
    // final candidate never reached verification). Always the candidate's OWN state.
    ...(candidate.ledger === undefined ? {} : { ledger: candidate.ledger }),
    ...(candidate.provenance === undefined ? {} : { provenance: candidate.provenance })
  };
};
