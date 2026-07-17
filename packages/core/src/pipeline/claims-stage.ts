import type { BlockEntity, ClaimAnchor, ClaimEntity, Codemap, Finding, PageEntity } from '@docstube/contracts';
import { idPrefixes, mintId } from '@docstube/contracts';
import type { PageArtifact } from '@docstube/plugin-sdk';
import { buildExtractClaimsTask, claimsFromTranscript } from '../audit/extract-claims.ts';
import type { ExtractedClaim } from '../audit/extract-claims.ts';
import { buildCodemapIndex, matchClaim } from '../audit/match-claims.ts';
import { blockSourceRanges } from '../entities/extract-entities.ts';
import type { RunJournal } from '../state/run-journal.ts';
import type { TaskRunner } from './page-runner.ts';
import type { RunCostTracker } from './run-cost.ts';

// Claim extraction for OUR generated docs (the finest entity grain, PRODUCT §3.1) — the same
// extractor and deterministic matcher `docstube audit` points at foreign docs. Runs on the
// passing path of the page loop: a claim whose identifier does not exist in the codemap is a
// stale reference the writer just produced, and it gates like any other error finding.
//   grounded      → claim guarantee 'proven'  (codemap existence is the deterministic check)
//   unverifiable  → 'scored' (prose claims — the persona review is what assessed them)
//   defect        → error finding → bounded retry, then flag; never silently wrong.

const flattenBlocks = (page: PageEntity): BlockEntity[] => [
  ...page.preamble,
  ...page.sections.flatMap((section) => section.blocks)
];

// Web-annotation-style anchoring: a short quote can occur several times; the prefix/suffix
// context decides which occurrence the claim means. Score = matching context characters
// (longest suffix of anchor.prefix before the quote + longest prefix of anchor.suffix after it);
// ties keep the first occurrence.
const anchorContextScore = (mdx: string, at: number, anchor: ClaimAnchor): number => {
  let before = 0;
  while (
    before < anchor.prefix.length &&
    at - before - 1 >= 0 &&
    anchor.prefix[anchor.prefix.length - 1 - before] === mdx[at - before - 1]
  ) {
    before += 1;
  }
  const end = at + anchor.quote.length;
  let after = 0;
  while (after < anchor.suffix.length && end + after < mdx.length && anchor.suffix[after] === mdx[end + after]) {
    after += 1;
  }
  return before + after;
};

export const resolveAnchorOffset = (mdx: string, anchor: ClaimAnchor): number => {
  const occurrences: number[] = [];
  let from = 0;
  while (true) {
    const at = mdx.indexOf(anchor.quote, from);
    if (at === -1) {
      break;
    }
    occurrences.push(at);
    from = at + 1;
  }
  if (occurrences.length <= 1) {
    return occurrences[0] ?? -1;
  }
  let best = occurrences[0]!;
  let bestScore = anchorContextScore(mdx, best, anchor);
  for (const at of occurrences.slice(1)) {
    const score = anchorContextScore(mdx, at, anchor);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
};

const claimToEntity = (claim: ExtractedClaim, guarantee: ClaimEntity['guarantee']): ClaimEntity => ({
  id: mintId(idPrefixes.claim),
  kind: 'claim',
  text: claim.text,
  anchor: claim.anchor,
  claimClass: claim.claimClass,
  guarantee
});

export type ClaimsStageResult = {
  page: PageEntity;
  findings: Finding[];
  attached: number;
  // Claims whose anchor quote could not be located in the page (dropped, visible in the count).
  unanchored: number;
  warning?: string | undefined;
};

export const attachExtractedClaims = async (input: {
  artifact: PageArtifact;
  codemap: Codemap;
  runTask: TaskRunner;
  journal: RunJournal;
  // Run-cost accounting (optional so direct callers/tests without a run budget stay simple).
  costTracker?: RunCostTracker | undefined;
}): Promise<ClaimsStageResult> => {
  const { artifact } = input;
  const task = buildExtractClaimsTask({ file: artifact.mdxPath, markdown: artifact.mdx });
  await input.journal.append({ type: 'task-started', taskId: task.id, pageId: artifact.page.id });
  const transcript = await input.runTask(task);
  await input.journal.append({
    type: 'task-completed',
    taskId: task.id,
    pageId: artifact.page.id,
    usage: transcript.usage
  });
  input.costTracker?.add(transcript.usage);
  const { claims, warning } = claimsFromTranscript(artifact.mdxPath, transcript);

  const blocks = flattenBlocks(artifact.page);
  const ranges = blockSourceRanges(artifact.mdx);
  const index = buildCodemapIndex(input.codemap);
  const claimsByBlock = new Map<string, ClaimEntity[]>();
  const findings: Finding[] = [];
  let attached = 0;
  let unanchored = 0;

  for (const claim of claims) {
    const offset = resolveAnchorOffset(artifact.mdx, claim.anchor);
    const blockIndex = offset === -1 ? -1 : ranges.findIndex(([start, end]) => offset >= start && offset < end);
    const block = blockIndex === -1 ? undefined : blocks[blockIndex];
    if (block === undefined) {
      unanchored += 1;
      continue;
    }
    // Content-unchanged blocks carry their claims (with stable ids) from the previous shard via
    // the matching pass — re-attaching would duplicate them.
    if (block.claims.length > 0) {
      continue;
    }
    const match = matchClaim(claim, index);
    if (match.status === 'defect') {
      for (const defect of match.defects) {
        findings.push({
          source: 'verifier',
          check: 'claim-grounding',
          severity: 'error',
          message: `claim "${claim.text.slice(0, 120)}" references ${defect.reason}`,
          entity: { version: artifact.version, locale: artifact.locale, pageId: artifact.page.id, entityId: block.id },
          file: artifact.mdxPath
        });
      }
      continue;
    }
    const pending = claimsByBlock.get(block.id) ?? [];
    pending.push(claimToEntity(claim, match.status === 'grounded' ? 'proven' : 'scored'));
    claimsByBlock.set(block.id, pending);
    attached += 1;
  }

  const withClaims = (block: BlockEntity): BlockEntity => {
    const pending = claimsByBlock.get(block.id);
    return pending === undefined ? block : { ...block, claims: pending };
  };
  const page: PageEntity = {
    ...artifact.page,
    preamble: artifact.page.preamble.map(withClaims),
    sections: artifact.page.sections.map((section) => ({ ...section, blocks: section.blocks.map(withClaims) }))
  };
  return { page, findings, attached, unanchored, warning };
};
