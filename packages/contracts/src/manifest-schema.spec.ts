import { describe, expect, it } from 'vitest';
import {
  buildFixtureClaimLedger,
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2
} from './fixtures.ts';
import { idPrefixes, mintId } from './primitives.ts';
import { manifestIndexSchema, pageShardRelativePath, pageShardSchema } from './manifest-schema.ts';

describe('manifest shards', () => {
  it('round-trips a page shard', () => {
    const shard = buildFixturePageShard(buildFixturePage());
    const parsed = pageShardSchema.parse(shard);
    expect(parsed.page.sections[0]?.blocks[0]?.provenance.sources[0]?.symbol).toMatch(/^ts:/);
  });

  it('places current-version shards under pages/ and frozen versions under versions/, as JSON', () => {
    const current = pageShardRelativePath({ locale: 'en', pageId: 'pg_x', currentVersion: 'latest' });
    expect(current).toBe('pages/en/pg_x.json');
    const frozen = pageShardRelativePath({ locale: 'de', pageId: 'pg_x', version: '1.x', currentVersion: 'latest' });
    expect(frozen).toBe('versions/1.x/pages/de/pg_x.json');
    const explicitCurrent = pageShardRelativePath({
      locale: 'en',
      pageId: 'pg_x',
      version: 'latest',
      currentVersion: 'latest'
    });
    expect(explicitCurrent).toBe('pages/en/pg_x.json');
  });

  it('accepts abbreviated, SHA-1, and SHA-256 commit ids on shards and versions', () => {
    const shard = buildFixturePageShard(buildFixturePage());
    for (const commit of ['a1b2c3d', 'a'.repeat(40), 'b'.repeat(64)]) {
      expect(pageShardSchema.safeParse({ ...shard, sourceCommit: commit }).success).toBe(true);
    }
    expect(pageShardSchema.safeParse({ ...shard, sourceCommit: 'c'.repeat(65) }).success).toBe(false);
  });

  it('requires at least one declared version in the index', () => {
    const index = {
      schemaVersion: 1,
      docstubeVersion: '0.0.2',
      sourceLocale: 'en',
      locales: ['en'],
      versions: [],
      pages: [],
      configHash: '0'.repeat(64),
      iaHash: '0'.repeat(64)
    };
    expect(manifestIndexSchema.safeParse(index).success).toBe(false);
    expect(
      manifestIndexSchema.safeParse({ ...index, versions: [{ label: 'latest', status: 'current' }] }).success
    ).toBe(true);
  });
});

const trustedShard = () => {
  const page = buildFixturePage();
  const ledger = buildFixtureClaimLedger(page.id);
  return { ...buildFixturePageShard(page), ledger, provenance: buildFixtureProvenanceV2(ledger) };
};

describe('shard ledger↔ClaimEvidence bijection (commit invariant)', () => {
  it('accepts a shard whose ledger and ClaimEvidence agree exactly', () => {
    expect(pageShardSchema.safeParse(trustedShard()).success).toBe(true);
  });

  it('rejects a ledger claim with no ClaimEvidence record', () => {
    const shard = trustedShard();
    const broken = {
      ...shard,
      provenance: { ...shard.provenance, claimEvidence: shard.provenance.claimEvidence.slice(0, 1) }
    };
    const result = pageShardSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('no ClaimEvidence record');
  });

  it('rejects a ClaimEvidence record with no ledger claim', () => {
    const shard = trustedShard();
    const broken = {
      ...shard,
      ledger: { ...shard.ledger, claims: shard.ledger.claims.slice(0, 1) }
    };
    const result = pageShardSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('no ledger claim');
  });

  it('rejects correctness/disposition disagreement between ledger and ClaimEvidence', () => {
    const shard = trustedShard();
    const broken = {
      ...shard,
      provenance: {
        ...shard.provenance,
        claimEvidence: shard.provenance.claimEvidence.map((record, index) =>
          index === 1 ? { ...record, correctness: 'checked' as const, disposition: null } : record
        )
      }
    };
    // Restore internal consistency of the mutated record so ONLY the cross-artifact check fires.
    const target = broken.provenance.claimEvidence[1];
    const deciding = target?.evidence[0];
    if (target !== undefined && deciding !== undefined && deciding.ref.kind === 'source-linked') {
      target.evidence = [
        {
          ...deciding,
          ref: {
            kind: 'value-predicate',
            symbol: deciding.ref.symbol,
            valueName: 'attempts',
            assertedValue: '3',
            extractedValue: '3'
          }
        }
      ];
      target.decidingEvidenceId = deciding.evidenceId;
    }
    const result = pageShardSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('disagrees with its ClaimEvidence record');
  });

  it('rejects a ledger without its provenance (and vice versa)', () => {
    const shard = trustedShard();
    const { provenance: _dropped, ...ledgerOnly } = shard;
    expect(pageShardSchema.safeParse(ledgerOnly).success).toBe(false);
    const { ledger: _dropped2, ...provenanceOnly } = shard;
    expect(pageShardSchema.safeParse(provenanceOnly).success).toBe(false);
  });

  it('rejects a ledger evidence handle that resolves to no canonical record', () => {
    const shard = trustedShard();
    const stray = mintId(idPrefixes.evidence);
    const broken = {
      ...shard,
      ledger: {
        ...shard.ledger,
        claims: shard.ledger.claims.map((claim, index) =>
          index === 1 ? { ...claim, evidence: [...claim.evidence, stray] } : claim
        )
      }
    };
    const result = pageShardSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('resolves to no canonical evidence record');
  });
});
