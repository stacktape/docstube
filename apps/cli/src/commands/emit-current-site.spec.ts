import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCodemap } from '@docstube/codemap';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore, loadConfigFamily, runGenerate } from '@docstube/core';
import { emitCurrentSite } from './emit-current-site.ts';

// The wave 2b-iii trust-spine E2E: generate on a real fixture repo → canonical JSON shards
// (kernel ledger + ClaimEvidence embedded) → emitCurrentSite → the theme's interim projection
// renders verified state from ClaimEvidence, never from the removed guarantee ladder.

let repoRoot: string;

const fixtureSource = 'export const DEFAULT_RETRIES = 3;\n';

const mdx = `---
title: "Retry"
description: "Retry defaults."
---

# Retry

<Claim id="v1">\`DEFAULT_RETRIES\` defaults to 3.</Claim>
`;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-emit-e2e-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'retry', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\nsite:\n  title: Retry Docs\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Retry\n    slug: retry\n    brief: How retries default.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('generate → JSON shards → emit (trust-spine E2E)', () => {
  it('emits the site with claim-count proof frontmatter projected from the shard ClaimEvidence', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'a'.repeat(40),
      packs: [typescriptLanguagePack],
      logger: { info: () => {}, warn: () => {} }
    });
    const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash;
    if (symbolHash === undefined) {
      throw new Error('fixture symbol missing from codemap');
    }
    const ledger: WriterClaimLedger = {
      schemaVersion: 1,
      claims: [
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'DEFAULT_RETRIES defaults to 3',
          proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue: '3' }]
        }
      ]
    } as WriterClaimLedger;
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      const base = {
        schemaVersion: 1 as const,
        taskId: spec.id,
        cacheKey: 'test',
        transport: 'replay',
        model: 'scripted',
        observedReads: [{ file: 'src/retry.ts', contentHash: '0'.repeat(64) }],
        usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
        stopReason: 'complete' as const,
        turns: []
      };
      if (spec.kind === 'review-page') {
        return {
          ...base,
          observedReads: [],
          result: {
            type: 'structured',
            value: {
              persona: 'app-developer',
              criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits' }],
              findings: []
            }
          }
        };
      }
      return { ...base, result: { type: 'mdx-ledger', mdx, ledger } };
    };

    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('passed');

    // Canonical JSON committed state: parseable as JSON, embedding the trust spine.
    const rawIndex = await readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8');
    const index = JSON.parse(rawIndex) as { pages: Array<{ id: string }> };
    const pageId = index.pages[0]?.id ?? '';
    const rawShard = await readFile(join(repoRoot, '.docstube', 'manifest', 'pages', 'en', `${pageId}.json`), 'utf8');
    expect(rawShard.endsWith('\n')).toBe(true);
    const shardJson = JSON.parse(rawShard) as {
      ledger?: { claims: Array<{ correctness: string }> };
      provenance?: { claimEvidence: Array<{ correctness: string }> };
    };
    expect(shardJson.ledger?.claims[0]?.correctness).toBe('checked');
    expect(shardJson.provenance?.claimEvidence[0]?.correctness).toBe('checked');

    // Emit consumes the shard through the interim ClaimEvidence projection.
    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    const result = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(result.emitted).toBe(true);

    const route = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'retry.mdx'), 'utf8');
    // Literal counts only — the guarantee-label projection is gone (impl-07 finding 4).
    expect(route).not.toContain('docstubeGuarantee');
    expect(route).toContain('docstubeClaimsChecked: 1');
    expect(route).toContain('docstubeClaimsTotal: 1');
    expect(route).toContain('docstubeClaimsContradicted: 0');
    // The completed primary-gating review earns the reviewed-for label.
    expect(route).toContain('docstubeReviewedFor: "app-developer"');
  }, 120_000);
});
