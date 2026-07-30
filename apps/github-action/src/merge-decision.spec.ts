import { describe, expect, it } from 'vitest';
import type { PublicationDecision } from '@docstube/contracts';
import {
  autoMergeBlockingFlagKinds,
  flagKindSchema,
  hashValue,
  outputInventorySchema,
  publicationDecisionSchema
} from '@docstube/contracts';
import {
  decideAutoMerge,
  loadPublicationArtifacts,
  outputInventoryRelativePath,
  publicationDecisionRelativePath,
  verifyOutputInventory
} from './merge-decision.ts';
import type { AutoMergeDecision, PublicationValidation } from './merge-decision.ts';
import { buildFixtureFlag, fixtureHeadCommit } from './test-support.ts';

const inventoryOf = (entries: { path: string; contentHash: string }[]) => ({ schemaVersion: 1, entries });

const decisionOf = (overrides: Record<string, unknown> = {}, entries: { path: string; contentHash: string }[] = []) =>
  ({
    schemaVersion: 1,
    toolVersion: '0.1.0',
    baseSha: fixtureHeadCommit,
    sourceSha: fixtureHeadCommit,
    candidateArtifactHash: hashValue(inventoryOf(entries)),
    execution: 'completed',
    plan: { planned: 2, completed: 2, deferred: 0 },
    deterministicGate: 'clean',
    regressions: [],
    newBlockingDispositions: [],
    coverageDelta: [],
    publishable: true,
    autoMergeEligible: true,
    reasonCodes: [],
    ...overrides
  }) as Record<string, unknown>;

const workspaceOf = (files: Record<string, string>) => async (path: string) => files[path];

const validPublication = (overrides: Record<string, unknown> = {}): PublicationValidation => ({
  ok: true,
  decision: publicationDecisionSchema.parse(decisionOf(overrides)) as PublicationDecision,
  inventory: outputInventorySchema.parse(inventoryOf([]))
});

const blockingKinds = (decision: AutoMergeDecision): string[] => decision.blockingFlags.map((flag) => flag.kind);

describe('publication artifact validation (fail closed)', () => {
  it('a missing decision, a missing inventory, and unreadable JSON are all refusals', async () => {
    const inventory = JSON.stringify(inventoryOf([]));
    const decision = JSON.stringify(decisionOf());

    await expect(loadPublicationArtifacts({ readWorkspaceFile: workspaceOf({}) })).resolves.toMatchObject({
      ok: false
    });
    await expect(
      loadPublicationArtifacts({ readWorkspaceFile: workspaceOf({ [outputInventoryRelativePath]: inventory }) })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      loadPublicationArtifacts({
        readWorkspaceFile: workspaceOf({
          [outputInventoryRelativePath]: inventory,
          [publicationDecisionRelativePath]: '{'
        })
      })
    ).resolves.toMatchObject({ ok: false });
    // The control: both present and consistent parses.
    await expect(
      loadPublicationArtifacts({
        readWorkspaceFile: workspaceOf({
          [outputInventoryRelativePath]: inventory,
          [publicationDecisionRelativePath]: decision
        })
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it('an unknown reason code is refused with the registry-version explanation, not a generic parse error', async () => {
    const result = await loadPublicationArtifacts({
      readWorkspaceFile: workspaceOf({
        [outputInventoryRelativePath]: JSON.stringify(inventoryOf([])),
        [publicationDecisionRelativePath]: JSON.stringify(
          decisionOf({
            deterministicGate: 'blocked',
            publishable: false,
            autoMergeEligible: false,
            reasonCodes: ['gate.blocked', 'policy.invented-later']
          })
        )
      })
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('policy.invented-later');
    expect(result.ok === false && result.reason).toContain('registry v1');
  });

  it('refuses a decision bound to another inventory or another commit', async () => {
    const inventory = JSON.stringify(inventoryOf([{ path: 'docs/a.mdx', contentHash: '0'.repeat(64) }]));

    const wrongTree = await loadPublicationArtifacts({
      readWorkspaceFile: workspaceOf({
        [outputInventoryRelativePath]: inventory,
        [publicationDecisionRelativePath]: JSON.stringify(decisionOf())
      })
    });
    expect(wrongTree.ok === false && wrongTree.reason).toContain('different tree');

    const wrongCommit = await loadPublicationArtifacts({
      headCommit: 'c'.repeat(40),
      readWorkspaceFile: workspaceOf({
        [outputInventoryRelativePath]: JSON.stringify(inventoryOf([])),
        [publicationDecisionRelativePath]: JSON.stringify(decisionOf())
      })
    });
    expect(wrongCommit.ok === false && wrongCommit.reason).toContain('different revision');
  });
});

describe('output inventory allowlist', () => {
  const inventory = outputInventorySchema.parse({
    schemaVersion: 1,
    entries: [
      { path: 'docs-site/content/en/a.mdx', contentHash: 'a'.repeat(64) },
      { path: '.docstube/manifest/manifest.json', contentHash: 'b'.repeat(64) }
    ]
  });
  const hashes: Record<string, string> = {
    'docs-site/content/en/a.mdx': 'a'.repeat(64),
    '.docstube/manifest/manifest.json': 'b'.repeat(64)
  };

  it('stages declared paths, accepts declared-root deletions, and reports everything else', async () => {
    const check = await verifyOutputInventory({
      inventory,
      candidatePaths: [
        'docs-site/content/en/a.mdx',
        '.docstube/manifest/manifest.json',
        // A pruned route inside a declared root: gone from disk, still a legitimate deletion.
        'docs-site/content/en/removed.mdx',
        // Not docstube's to write.
        'src/retry.ts'
      ],
      hashWorkspaceFile: async (path) => hashes[path]
    });

    expect(check.stagedPaths).toEqual([
      '.docstube/manifest/manifest.json',
      'docs-site/content/en/a.mdx',
      'docs-site/content/en/removed.mdx'
    ]);
    expect(check.undeclaredPaths).toEqual(['src/retry.ts']);
    expect(check.hashMismatches).toEqual([]);
  });

  it('reports a declared path whose bytes drifted', async () => {
    const check = await verifyOutputInventory({
      inventory,
      candidatePaths: ['docs-site/content/en/a.mdx'],
      hashWorkspaceFile: async () => 'f'.repeat(64)
    });
    expect(check.hashMismatches).toEqual(['docs-site/content/en/a.mdx']);
  });
});

describe('auto-merge gate', () => {
  it('merges a clean completed run with no flags and no regressions', () => {
    const decision = decideAutoMerge({ flags: [], publication: validPublication() });
    expect(decision.autoMerge).toBe(true);
    expect(decision.withheldReasons).toEqual([]);
  });

  // The flag rule table is unchanged — it is now one input among several, not the whole gate.
  it.each(autoMergeBlockingFlagKinds.map((kind) => [kind] as const))(
    'a single open %s flag still blocks auto-merge',
    (kind) => {
      const decision = decideAutoMerge({ flags: [buildFixtureFlag({ kind })], publication: validPublication() });
      expect(decision.autoMerge).toBe(false);
      expect(blockingKinds(decision)).toEqual([kind]);
    }
  );

  it('covers every non-blocking kind explicitly: only tribal-knowledge is non-blocking in v1', () => {
    const nonBlocking = flagKindSchema.options.filter((kind) => !autoMergeBlockingFlagKinds.includes(kind));
    expect(nonBlocking).toEqual(['tribal-knowledge']);
  });

  it('an open tribal-knowledge flag alone does NOT block auto-merge but stays visible', () => {
    const decision = decideAutoMerge({
      flags: [buildFixtureFlag({ kind: 'tribal-knowledge' })],
      publication: validPublication()
    });
    expect(decision.autoMerge).toBe(true);
    expect(decision.openFlags).toHaveLength(1);
  });

  it('non-open flags of blocking kinds never block', () => {
    const decision = decideAutoMerge({
      flags: [
        buildFixtureFlag({ kind: 'guarantee-downgrade', status: 'resolved' }),
        buildFixtureFlag({ kind: 'system', status: 'dismissed' })
      ],
      publication: validPublication()
    });
    expect(decision.autoMerge).toBe(true);
    expect(decision.openFlags).toHaveLength(0);
  });

  it('an invalid publication artifact blocks even when every flag is clean', () => {
    const decision = decideAutoMerge({ flags: [], publication: { ok: false, reason: 'artifact absent.' } });
    expect(decision.autoMerge).toBe(false);
    expect(decision.withheldReasons.join(' ')).toContain('No enforceable publication decision');
  });

  it('a paused-budget run with zero flags is withheld and names the deferred work', () => {
    const decision = decideAutoMerge({
      flags: [],
      publication: validPublication({
        execution: 'paused-budget',
        plan: { planned: 5, completed: 2, deferred: 3 },
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['budget.frozen', 'plan.deferred']
      })
    });
    expect(decision.autoMerge).toBe(false);
    expect(decision.withheldReasons.join(' ')).toContain('3 were deferred');
    expect(decision.reasonCodes).toEqual(['budget.frozen', 'plan.deferred']);
  });

  it('a failed run is withheld and reported as failed', () => {
    const decision = decideAutoMerge({
      flags: [],
      publication: validPublication({
        execution: 'failed',
        plan: { planned: 5, completed: 0, deferred: 5 },
        deterministicGate: 'blocked',
        publishable: false,
        autoMergeEligible: false,
        reasonCodes: ['execution.failed', 'gate.blocked', 'plan.deferred']
      })
    });
    expect(decision.autoMerge).toBe(false);
    expect(decision.withheldReasons.join(' ')).toContain('The run FAILED');
  });

  it('a ledger regression is named on the PR', () => {
    const decision = decideAutoMerge({
      flags: [],
      publication: validPublication({
        autoMergeEligible: false,
        regressions: [{ kind: 'attestation-loss', pageId: 'pg_0000000000000000000a', detail: 'claim cl_x lost it' }],
        reasonCodes: ['ledger.regression']
      })
    });
    expect(decision.autoMerge).toBe(false);
    expect(decision.withheldReasons.join(' ')).toContain('attestation-loss');
    expect(decision.withheldReasons.join(' ')).toContain('pg_0000000000000000000a');
  });

  it('undeclared writes and hash drift block a decision that is otherwise eligible', () => {
    const decision = decideAutoMerge({
      flags: [],
      publication: validPublication(),
      inventory: { stagedPaths: [], undeclaredPaths: ['src/retry.ts'], hashMismatches: ['docs-site/a.mdx'] }
    });
    expect(decision.autoMerge).toBe(false);
    expect(decision.withheldReasons.join(' ')).toContain('src/retry.ts');
    expect(decision.withheldReasons.join(' ')).toContain('docs-site/a.mdx');
  });
});
