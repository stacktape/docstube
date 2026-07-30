import type { Flag, OutputInventory, PublicationDecision } from '@docstube/contracts';
import {
  autoMergeBlockingFlagKinds,
  hashValue,
  outputInventorySchema,
  publicationDecisionSchema,
  publicationReasonCodeRegistryVersion
} from '@docstube/contracts';
import type { WorkspaceFileReader } from './verified-delta.ts';

// THE AUTO-MERGE GATE (PRODUCT §3.3, quality-ci-reader-v2 decisions 9 + 11). The Action does not
// decide publishability — the KERNEL does, in one artifact bound to the candidate tree. This module
// only validates that artifact and enforces it. Open blocking flags remain a rule, but they are now
// one input among several rather than the whole gate: a frozen or partially executed run that
// happens to carry no blocking flag must never merge unattended.
//
// WHY THE ACTION VALIDATES INSTEAD OF IMPORTING THE KERNEL: the Action runs the user's pinned
// docstube CLI, which may be a DIFFERENT version than the Action itself. It therefore depends on
// `@docstube/contracts` (pure schemas, no kernel behaviour) and treats any parse failure as
// fail-closed. That includes the reason-code registry: the enum is closed and versioned, so a newer
// CLI emitting a code this Action cannot interpret fails the parse — never reads as "fine".

// Machine-local, gitignored, and excluded from the commit paths — the artifacts describe the
// candidate, they are not part of it.
export const publicationDecisionRelativePath = '.docstube/runs/publication-decision.json';
export const outputInventoryRelativePath = '.docstube/runs/output-inventory.json';

export type PublicationValidation =
  | { ok: true; decision: PublicationDecision; inventory: OutputInventory }
  | { ok: false; reason: string };

type ZodLikeIssue = { code?: unknown; path?: unknown[]; message?: unknown };

// An unknown reason code is the ONE parse failure that deserves its own sentence: it means the CLI
// knows a blocking condition this Action does not, which is precisely when a silent "invalid
// artifact" message would invite someone to shrug and merge manually.
const unknownReasonCode = (error: unknown, raw: unknown): string | undefined => {
  const issues = (error as { issues?: ZodLikeIssue[] } | undefined)?.issues ?? [];
  if (!issues.some((issue) => Array.isArray(issue.path) && issue.path[0] === 'reasonCodes')) {
    return undefined;
  }
  const codes = (raw as { reasonCodes?: unknown } | undefined)?.reasonCodes;
  const listed = Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
  return (
    `the decision carries a reason code this Action cannot interpret (${listed.join(', ') || 'unreadable'}). ` +
    `This Action understands publication reason-code registry v${publicationReasonCodeRegistryVersion}; a newer ` +
    'docstube CLI is reporting a blocking condition it does not know about, so the merge is withheld. Update the ' +
    'docstube Action to match the pinned CLI.'
  );
};

const readJson = async (
  readWorkspaceFile: WorkspaceFileReader,
  path: string
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> => {
  const text = await readWorkspaceFile(path);
  if (text === undefined) {
    return {
      ok: false,
      reason: `no publication decision was found at \`${path}\`. Auto-merge requires \`docstube generate --ci\` — a run that emits no decision proves nothing about itself.`
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: `\`${path}\` is not readable JSON: ${(error as Error).message}` };
  }
};

// Reads, parses, and BINDS the two artifacts. Every failure path returns a reason string that ends
// up on the PR — a withheld merge must never look like a silent no-op.
export const loadPublicationArtifacts = async (input: {
  readWorkspaceFile: WorkspaceFileReader;
  // The commit the workspace was at when the CLI ran. A decision bound to a different revision
  // describes a different candidate.
  headCommit?: string | undefined;
}): Promise<PublicationValidation> => {
  const rawInventory = await readJson(input.readWorkspaceFile, outputInventoryRelativePath);
  if (!rawInventory.ok) {
    return rawInventory;
  }
  const rawDecision = await readJson(input.readWorkspaceFile, publicationDecisionRelativePath);
  if (!rawDecision.ok) {
    return rawDecision;
  }

  const parsedInventory = outputInventorySchema.safeParse(rawInventory.value);
  if (!parsedInventory.success) {
    return {
      ok: false,
      reason: `the output inventory does not satisfy the contract: ${parsedInventory.error.message}`
    };
  }
  const parsedDecision = publicationDecisionSchema.safeParse(rawDecision.value);
  if (!parsedDecision.success) {
    return {
      ok: false,
      reason:
        unknownReasonCode(parsedDecision.error, rawDecision.value) ??
        `the publication decision does not satisfy the contract: ${parsedDecision.error.message}`
    };
  }

  const decision = parsedDecision.data;
  const inventory = parsedInventory.data;
  const binding = hashValue(inventory);
  if (decision.candidateArtifactHash !== binding) {
    return {
      ok: false,
      reason: `the publication decision is bound to candidate tree ${decision.candidateArtifactHash.slice(0, 12)}, but the output inventory in this workspace hashes to ${binding.slice(0, 12)} — the decision describes a different tree.`
    };
  }
  if (input.headCommit !== undefined && decision.sourceSha !== input.headCommit) {
    return {
      ok: false,
      reason: `the publication decision was produced at commit ${decision.sourceSha.slice(0, 12)}, but this run generated at ${input.headCommit.slice(0, 12)} — the decision describes a different revision.`
    };
  }
  return { ok: true, decision, inventory };
};

export type InventoryCheck = {
  // Exactly the paths the Action may stage: declared by the inventory (or a deletion inside a
  // declared root) AND reported dirty by git.
  stagedPaths: readonly string[];
  // Dirty paths the run never declared — an agent editing source, a stray tool write. Reported and
  // fatal to eligibility (decision 11).
  undeclaredPaths: readonly string[];
  // Declared paths whose bytes on disk disagree with the declared hash, or vanished.
  hashMismatches: readonly string[];
};

// The commit boundary is an allowlist, not a filter over "everything that changed". Deletions are
// the one thing an inventory of content hashes cannot list, so a dirty path that no longer exists
// is accepted only when it sits inside a root the inventory actually declares — a deleted
// `src/thing.ts` is still undeclared, and still blocks.
export const verifyOutputInventory = async (input: {
  inventory: OutputInventory;
  candidatePaths: readonly string[];
  hashWorkspaceFile: (relativePath: string) => Promise<string | undefined>;
}): Promise<InventoryCheck> => {
  const declared = new Map(input.inventory.entries.map((entry) => [entry.path, entry.contentHash as string]));
  const declaredRoots = new Set([...declared.keys()].map((path) => path.split('/')[0]));
  const stagedPaths: string[] = [];
  const undeclaredPaths: string[] = [];
  const hashMismatches: string[] = [];

  for (const path of input.candidatePaths) {
    const expected = declared.get(path);
    const actual = await input.hashWorkspaceFile(path);
    if (expected !== undefined) {
      if (actual !== expected) {
        hashMismatches.push(path);
      }
      stagedPaths.push(path);
      continue;
    }
    if (actual === undefined && declaredRoots.has(path.split('/')[0] ?? '')) {
      // A declared root losing a file: the reconciler pruned it, and the commit must carry the
      // deletion or the branch would keep resurrecting it.
      stagedPaths.push(path);
      continue;
    }
    undeclaredPaths.push(path);
  }

  return { stagedPaths: stagedPaths.toSorted(), undeclaredPaths: undeclaredPaths.toSorted(), hashMismatches };
};

export type AutoMergeDecision = {
  autoMerge: boolean;
  openFlags: readonly Flag[];
  blockingFlags: readonly Flag[];
  publication: PublicationValidation;
  // Every reason the merge was withheld, in PR-ready prose. Empty exactly when autoMerge is true.
  withheldReasons: readonly string[];
  // The kernel's own reason codes, passed through verbatim — never re-derived here.
  reasonCodes: readonly string[];
  undeclaredPaths: readonly string[];
  hashMismatches: readonly string[];
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export const decideAutoMerge = (input: {
  flags: readonly Flag[];
  publication: PublicationValidation;
  inventory?: InventoryCheck | undefined;
}): AutoMergeDecision => {
  const openFlags = input.flags.filter((flag) => flag.status === 'open');
  const blockingFlags = openFlags.filter((flag) => autoMergeBlockingFlagKinds.includes(flag.kind));
  const withheldReasons: string[] = [];

  if (blockingFlags.length > 0) {
    withheldReasons.push(
      `${plural(blockingFlags.length, 'open blocking flag')} (${[...new Set(blockingFlags.map((flag) => flag.kind))].join(', ')}).`
    );
  }

  if (!input.publication.ok) {
    withheldReasons.push(`No enforceable publication decision — ${input.publication.reason}`);
    return {
      autoMerge: false,
      openFlags,
      blockingFlags,
      publication: input.publication,
      withheldReasons,
      reasonCodes: [],
      undeclaredPaths: input.inventory?.undeclaredPaths ?? [],
      hashMismatches: input.inventory?.hashMismatches ?? []
    };
  }

  const { decision } = input.publication;
  if (decision.execution !== 'completed') {
    withheldReasons.push(
      decision.execution === 'paused-budget'
        ? `The run PAUSED at its budget cap after ${decision.plan.completed} of ${decision.plan.planned} planned page(s); ${decision.plan.deferred} were deferred. Staged work publishes atomically, so nothing merges until the plan completes — rerun the workflow to continue (finished pages are not re-billed).`
        : `The run FAILED after ${decision.plan.completed} of ${decision.plan.planned} planned page(s).`
    );
  } else if (decision.plan.deferred > 0) {
    withheldReasons.push(`${plural(decision.plan.deferred, 'planned page')} were deferred — the plan is incomplete.`);
  }
  if (decision.deterministicGate === 'blocked') {
    withheldReasons.push('The deterministic gate is blocked.');
  }
  for (const regression of decision.regressions) {
    withheldReasons.push(
      `Guarantee downgrade (${regression.kind}) on page ${regression.pageId}${regression.detail ? `: ${regression.detail}` : ''}.`
    );
  }
  if (decision.newBlockingDispositions.length > 0) {
    withheldReasons.push(
      `${plural(decision.newBlockingDispositions.length, 'new blocking claim disposition')}: ` +
        decision.newBlockingDispositions
          .slice(0, 5)
          .map((entry) => `${entry.claimId} (${entry.status}) on ${entry.pageId}`)
          .join(', ') +
        '.'
    );
  }
  if (!decision.publishable) {
    withheldReasons.push('The kernel marked this candidate not publishable.');
  } else if (!decision.autoMergeEligible) {
    withheldReasons.push('The kernel marked this candidate publishable but not auto-merge eligible.');
  }

  const undeclaredPaths = input.inventory?.undeclaredPaths ?? [];
  const hashMismatches = input.inventory?.hashMismatches ?? [];
  if (undeclaredPaths.length > 0) {
    withheldReasons.push(
      `${plural(undeclaredPaths.length, 'path')} changed outside the declared output inventory: ${undeclaredPaths
        .slice(0, 5)
        .map((path) => `\`${path}\``)
        .join(', ')}.`
    );
  }
  if (hashMismatches.length > 0) {
    withheldReasons.push(
      `${plural(hashMismatches.length, 'declared path')} no longer match the hash the run recorded: ${hashMismatches
        .slice(0, 5)
        .map((path) => `\`${path}\``)
        .join(', ')}.`
    );
  }

  return {
    autoMerge: withheldReasons.length === 0,
    openFlags,
    blockingFlags,
    publication: input.publication,
    withheldReasons,
    reasonCodes: decision.reasonCodes,
    undeclaredPaths,
    hashMismatches
  };
};
