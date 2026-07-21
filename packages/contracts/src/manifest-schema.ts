import { z } from 'zod';
import { claimLedgerSchema } from './claim-ledger-schema.ts';
import { pageEntitySchema } from './entity-schema.ts';
import { flagSchema } from './flag-schema.ts';
import {
  claimIdSchema,
  isoTimestampSchema,
  localeCodeSchema,
  pageIdSchema,
  repoPathSchema,
  semverSchema,
  sha256HexSchema,
  versionLabelSchema
} from './primitives.ts';
import { provenanceV2Schema } from './provenance-v2-schema.ts';

// The committed manifest is the lockfile of the docs (PRODUCT §3.10): derived state committed for
// determinism and branch-correctness. Sharded one-file-per-page-per-locale so parallel PRs never
// conflict; `manifest.json` holds only slow-moving index data. Machine-owned committed state is
// canonical sorted-key JSON (harness-state-v2 decision 12) — byte-stable when content is
// unchanged; human-owned files (docstube.yml, ia.yml, criteria, instructions) stay YAML.

export const manifestPageIndexEntrySchema = z.object({
  id: pageIdSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  // Path of the generated MDX relative to the site content root, for the source locale.
  path: repoPathSchema
});

export const manifestVersionSchema = z.object({
  label: versionLabelSchema,
  // `current` is live from HEAD; `frozen` snapshots were cut at release time (model C).
  status: z.enum(['current', 'frozen']),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .optional(),
  cutAt: isoTimestampSchema.optional()
});

export const coverageStatsSchema = z.object({
  publicSymbols: z.number().int().nonnegative(),
  documentedSymbols: z.number().int().nonnegative()
});

export const manifestIndexSchema = z.object({
  schemaVersion: z.literal(1),
  docstubeVersion: semverSchema,
  sourceLocale: localeCodeSchema,
  locales: z.array(localeCodeSchema),
  versions: z.array(manifestVersionSchema).min(1),
  pages: z.array(manifestPageIndexEntrySchema),
  // Content hashes of the intent files the docs were generated from.
  configHash: sha256HexSchema,
  iaHash: sha256HexSchema,
  // Doc-type-conditional (on for libraries/SDKs, off for apps/services).
  coverage: coverageStatsSchema.optional(),
  // Cross-page and system-level flags; entity-scoped flags live in page shards.
  systemFlags: z.array(flagSchema).default([])
});
export type ManifestIndex = z.infer<typeof manifestIndexSchema>;

// Claim-identity threading records (trust-model-v2 decision 8, persisted since wave 2b-iii): a
// match records the CARRIED claim id and its threading confidence. Ambiguity is a drift marker —
// every carried human thread renders "content changed substantially since this was written" —
// and must name why; an exact match must not.
export const claimMatchDriftReasonSchema = z.enum(['equal-candidates', 'block-thread-inexact']);
export type ClaimMatchDriftReason = z.infer<typeof claimMatchDriftReasonSchema>;

export const claimMatchRecordSchema = z
  .object({
    // The prior claim id the fresh claim threads onto (the id now carried in the ledger).
    claimId: claimIdSchema,
    confidence: z.enum(['exact', 'ambiguous']),
    drift: z.array(claimMatchDriftReasonSchema).default([])
  })
  .superRefine((record, ctx) => {
    if (record.confidence === 'ambiguous' && record.drift.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['drift'],
        message: 'an ambiguous match must name its drift reason(s)'
      });
    }
    if (record.confidence === 'exact' && record.drift.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['drift'], message: 'an exact match carries no drift reasons' });
    }
  });
export type ClaimMatchRecord = z.infer<typeof claimMatchRecordSchema>;

// A prior claim no fresh claim threaded onto: its human threads surface for re-attachment or
// dismissal — never a silent disappearance.
export const claimOrphanRecordSchema = z.object({ claimId: claimIdSchema });
export type ClaimOrphanRecord = z.infer<typeof claimOrphanRecordSchema>;

export const claimMatchingSchema = z.object({
  matches: z.array(claimMatchRecordSchema).default([]),
  orphans: z.array(claimOrphanRecordSchema).default([])
});
export type ClaimMatching = z.infer<typeof claimMatchingSchema>;

// One shard = one page in one locale: `.docstube/manifest/pages/<locale>/<pageId>.json`
// (frozen versions under `.docstube/manifest/versions/<version>/pages/…`). Since schemaVersion 2
// (wave 2b-iii) the shard embeds the trust spine directly: the kernel claim ledger, the
// ProvenanceV2 record (whose claimEvidence is the ONLY reader-facing trust surface), and the
// typed claim-matching records. Both are absent only when the page never reached a kernel ledger
// (e.g. anchoring kept failing) — a contradicted final state persists WITH its ledger/evidence,
// loud and machine-readable, never as a bare flag over clean-looking prose.
export const pageShardSchema = z
  .object({
    schemaVersion: z.literal(2),
    locale: localeCodeSchema,
    version: versionLabelSchema,
    sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/),
    generatedAt: isoTimestampSchema,
    page: pageEntitySchema,
    ledger: claimLedgerSchema.optional(),
    provenance: provenanceV2Schema.optional(),
    claimMatching: claimMatchingSchema.optional(),
    flags: z.array(flagSchema).default([]),
    // Reserved for the signed-provenance contract (PRODUCT §4.2); unsigned in v1.
    signature: z.string().optional()
  })
  .superRefine((shard, ctx) => {
    // The ledger↔ClaimEvidence bijection is a COMMIT-TIME invariant (impl-06 finding 5): the two
    // artifacts describe the same claims and must agree on identity, class, correctness,
    // disposition, evidence handles, and the deciding id. A shard carrying one without the other,
    // or with any disagreement, is corrupt and must not parse.
    if (shard.ledger === undefined && shard.provenance === undefined) {
      return;
    }
    if (shard.ledger === undefined || shard.provenance === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [shard.ledger === undefined ? 'ledger' : 'provenance'],
        message: 'ledger and provenance persist together — one without the other cannot prove the bijection'
      });
      return;
    }
    const evidenceByClaimId = new Map(shard.provenance.claimEvidence.map((record) => [record.claimId, record]));
    if (evidenceByClaimId.size !== shard.provenance.claimEvidence.length) {
      // provenanceV2Schema already rejects duplicate claim ids; guard anyway.
      return;
    }
    for (const claim of shard.ledger.claims) {
      const record = evidenceByClaimId.get(claim.claimId);
      if (record === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', 'claimEvidence'],
          message: `ledger claim "${claim.claimId}" has no ClaimEvidence record — the bijection is broken`
        });
        continue;
      }
      evidenceByClaimId.delete(claim.claimId);
      const mismatches: string[] = [];
      if (record.class !== claim.class) {
        mismatches.push(`class (${claim.class} vs ${record.class})`);
      }
      if (record.correctness !== claim.correctness) {
        mismatches.push(`correctness (${claim.correctness} vs ${record.correctness})`);
      }
      if (record.disposition !== claim.disposition) {
        mismatches.push(`disposition (${String(claim.disposition)} vs ${String(record.disposition)})`);
      }
      if (record.decidingEvidenceId !== claim.decidingEvidenceId) {
        mismatches.push('decidingEvidenceId');
      }
      const recordEvidenceIds = new Set(record.evidence.map((entry) => entry.evidenceId));
      for (const evidenceId of claim.evidence) {
        if (!recordEvidenceIds.has(evidenceId)) {
          mismatches.push(`evidence handle "${evidenceId}" resolves to no canonical evidence record`);
        }
      }
      if (mismatches.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['provenance', 'claimEvidence'],
          message: `ledger claim "${claim.claimId}" disagrees with its ClaimEvidence record: ${mismatches.join('; ')}`
        });
      }
    }
    for (const claimId of evidenceByClaimId.keys()) {
      ctx.addIssue({
        code: 'custom',
        path: ['provenance', 'claimEvidence'],
        message: `ClaimEvidence record "${claimId}" has no ledger claim — the bijection is broken`
      });
    }
  });
export type PageShard = z.infer<typeof pageShardSchema>;

export const pageShardRelativePath = (input: {
  locale: string;
  pageId: string;
  version?: string | undefined;
  currentVersion: string;
}): string => {
  const base =
    input.version !== undefined && input.version !== input.currentVersion ? `versions/${input.version}/pages` : 'pages';
  return `${base}/${input.locale}/${input.pageId}.json`;
};
