import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { runGenerate } from './generate.ts';
import {
  createRunCostTracker,
  ESTIMATE_USD_PER_1M_INPUT_TOKENS,
  ESTIMATE_USD_PER_1M_OUTPUT_TOKENS,
  FREEZE_MARGIN_RATIO,
  freezeReason
} from './run-cost.ts';

// Cap-freeze behavior (PRODUCT §3.5): usage caps are approximate — the run freezes with margin
// at 85% of agents.budgets.maxRunUsd, between pages only. Scripted task costs make the freeze
// point deterministic: write $0.50 + review $0.20 + claims $0.10 = $0.80 per page, so with a
// $0.90 cap (threshold $0.765) page 1 ships and the freeze lands before page 2.

const WRITE_COST = 0.5;
const REVIEW_COST = 0.2;
const CLAIMS_COST = 0.1;
const PAGE_COST = WRITE_COST + REVIEW_COST + CLAIMS_COST;

describe('createRunCostTracker', () => {
  it('freezes at the margin threshold, not at the cap itself', () => {
    const tracker = createRunCostTracker(10);
    tracker.add({ costUsd: 8.4 });
    expect(tracker.shouldFreeze()).toBe(false);
    // 8.5 == 10 * 0.85 — the margin threshold is inclusive.
    tracker.add({ costUsd: 0.1 });
    expect(tracker.spentUsd()).toBeCloseTo(10 * FREEZE_MARGIN_RATIO, 10);
    expect(tracker.shouldFreeze()).toBe(true);
  });

  it('never freezes without a cap and ignores usage carrying neither cost nor tokens', () => {
    const tracker = createRunCostTracker();
    tracker.add({ costUsd: 1000 });
    expect(tracker.shouldFreeze()).toBe(false);
    expect(tracker.hasReportedCost()).toBe(true);

    const costless = createRunCostTracker(1);
    costless.add({});
    costless.add({ costUsd: undefined });
    expect(costless.spentUsd()).toBe(0);
    expect(costless.hasReportedCost()).toBe(false);
    expect(costless.hasEstimates()).toBe(false);
    expect(costless.shouldFreeze()).toBe(false);
  });

  it('estimates spend from tokens when a transport reports no costUsd, so the cap never no-ops', () => {
    const tracker = createRunCostTracker(10);
    tracker.add({ inputTokens: 1_000_000, outputTokens: 200_000 });
    expect(tracker.spentUsd()).toBe(0);
    expect(tracker.hasReportedCost()).toBe(false);
    expect(tracker.hasEstimates()).toBe(true);
    expect(tracker.estimatedUsd()).toBeCloseTo(
      ESTIMATE_USD_PER_1M_INPUT_TOKENS + 0.2 * ESTIMATE_USD_PER_1M_OUTPUT_TOKENS,
      10
    );
  });

  it('freezes on reported + estimated spend combined', () => {
    const tracker = createRunCostTracker(10);
    tracker.add({ costUsd: 5 });
    // $5 reported + $4 estimated (500k in = $2.5, 100k out = $1.5) = $9 >= $8.5 (10 * 0.85).
    tracker.add({ inputTokens: 500_000, outputTokens: 100_000 });
    expect(tracker.shouldFreeze()).toBe(true);
    expect(tracker.spentUsd()).toBe(5);
    expect(tracker.estimatedUsd()).toBeCloseTo(4, 10);
  });

  it('plan-usage governor: freezes at the plan threshold and silences estimate-based freezing', () => {
    // Subscription transports report tokens but no dollars; the first live regen froze a
    // flat-rate run at "$25 estimated". With a plan signal present, the plan cap is the truth.
    const tracker = createRunCostTracker(1, 80);
    tracker.add({ inputTokens: 10_000_000, outputTokens: 10_000_000, planUsedPercent: 30 });
    // $200 of estimates would trip the $1 cap — but the 30% plan signal suppresses estimates.
    expect(tracker.shouldFreeze()).toBe(false);
    tracker.add({ inputTokens: 1, outputTokens: 1, planUsedPercent: 80 });
    expect(tracker.shouldFreeze()).toBe(true);
    expect(tracker.planUsedPercent()).toBe(80);
  });

  it('plan signal never silences vendor-REPORTED dollars', () => {
    const tracker = createRunCostTracker(1, 80);
    tracker.add({ costUsd: 0.9, planUsedPercent: 10 });
    expect(tracker.shouldFreeze()).toBe(true);
  });

  it('freezeReason names the plan window when the plan cap tripped', () => {
    expect(freezeReason({ maxRunUsd: 20, maxPlanUsagePercent: 80, planUsedPercent: 81 })).toContain('81%');
    expect(freezeReason({ maxRunUsd: 20, maxPlanUsagePercent: 80, planUsedPercent: 10 })).toContain('$20');
  });

  it('a reported costUsd is never double-counted as an estimate, even with tokens present', () => {
    const tracker = createRunCostTracker(10);
    tracker.add({ costUsd: 1, inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(tracker.spentUsd()).toBe(1);
    expect(tracker.estimatedUsd()).toBe(0);
    expect(tracker.hasEstimates()).toBe(false);
  });
});

// --- End-to-end freeze over a real temp repo (scripted TaskRunner, never a live model). ---

let repoRoot: string;

const fixtureSource = `export type GreetOptions = {
  name: string;
  loud?: boolean;
};

export const greet = (options: GreetOptions): string => {
  const base = \`Hello, \${options.name}!\`;
  return options.loud ? base.toUpperCase() : base;
};
`;

const configYaml = (maxRunUsd?: number): string =>
  [
    'schemaVersion: 1',
    'docType: external-library',
    'projectContext: A tiny greeting library.',
    'personas:',
    '  - id: app-developer',
    '    description: Builds apps using the library',
    ...(maxRunUsd === undefined ? [] : ['agents:', '  budgets:', `    maxRunUsd: ${maxRunUsd}`]),
    'site:',
    '  title: Greeter Docs',
    ''
  ].join('\n');

const iaYaml = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: Install the library and greet someone.
  - title: Configuration
    slug: configuration
    brief: Configure greeting options.
  - title: Troubleshooting
    slug: troubleshooting
    brief: Fix common greeting problems.
`;

const goodMdx = `---
title: Getting started
description: Install and greet.
---

# Getting started

The library exposes a single \`greet\` function.

## Usage

\`\`\`ts
import { greet } from 'greeter';

const message: string = greet({ name: 'Ada' });
\`\`\`
`;

const baseTranscript = (spec: AgentTaskSpec, costUsd: number): Omit<Transcript, 'result' | 'turns'> => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  observedReads: [{ file: 'src/greeter.ts', contentHash: '0'.repeat(64) }],
  usage: { inputTokens: 1, outputTokens: 1, costUsd, cacheHit: false },
  stopReason: 'complete'
});

// Dispatches by task kind (same shape as generate.spec.ts) with a fixed cost per kind.
const scriptedRunner = () => {
  const writeCalls: AgentTaskSpec[] = [];
  const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
    if (spec.kind === 'review-page') {
      return {
        ...baseTranscript(spec, REVIEW_COST),
        observedReads: [],
        turns: [],
        result: {
          type: 'structured',
          value: {
            persona: 'app-developer',
            criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'Clear for app developers.' }],
            findings: []
          }
        }
      };
    }
    if (spec.kind === 'audit-extract-claims') {
      return {
        ...baseTranscript(spec, CLAIMS_COST),
        observedReads: [],
        turns: [],
        result: { type: 'structured', value: { claims: [] } }
      };
    }
    writeCalls.push(spec);
    return {
      ...baseTranscript(spec, WRITE_COST),
      turns: [{ role: 'assistant', blocks: [{ type: 'text', text: goodMdx }] }],
      result: { type: 'mdx', mdx: goodMdx }
    };
  };
  return { runTask, writeCalls };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-freeze-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(join(repoRoot, 'ia.yml'), iaYaml);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runGenerate under a run cost cap', () => {
  it('freezes with margin after page 1: remaining pages skipped, shipped page intact, run-frozen journaled', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const { runTask, writeCalls } = scriptedRunner();
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    // Page 1 spent $0.80 >= $0.765 (0.9 * 0.85): frozen before page 2 ever starts.
    expect(writeCalls).toHaveLength(1);
    expect(summary.outcome).toBe('frozen');
    expect(summary.pages).toHaveLength(1);
    expect(summary.pages[0]).toMatchObject({ slug: 'getting-started', status: 'passed' });
    expect(summary.spentUsd).toBeCloseTo(PAGE_COST, 10);

    // The journal carries run-frozen (with spend) and a frozen run-completed. readAll re-parses
    // every line against runEventSchema, so this also proves the emitted events are schema-valid.
    const journal = await createRunJournal(repoRoot, summary.runId);
    const events = await journal.readAll();
    const runFrozen = events.find((event) => event.type === 'run-frozen');
    expect(runFrozen).toMatchObject({
      type: 'run-frozen',
      spentUsd: expect.closeTo(PAGE_COST, 10),
      reason: expect.stringContaining('85%')
    });
    const runCompleted = events.at(-1);
    expect(runCompleted).toMatchObject({ type: 'run-completed', outcome: 'frozen' });

    // The already-shipped page stays shipped: shard + MDX intact; unstarted pages left nothing.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages.map((entry) => entry.slug)).toEqual(['getting-started']);
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.page.slug).toBe('getting-started');
    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('# Getting started');
    await expect(readFile(join(repoRoot, 'docs-site', 'content', 'en', 'configuration.mdx'), 'utf8')).rejects.toThrow(
      /ENOENT/
    );
  }, 60_000);

  it('a freeze never deletes pages a previous run finished — their index entries and shards survive', async () => {
    // Live regression: the first real cap-freeze wrote an index with only the reached pages, and
    // orphan pruning then deleted three committed shards.
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const full = scriptedRunner();
    await runGenerate({ repoRoot, runTask: full.runTask, toolDescriptors: [] });

    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const frozen = scriptedRunner();
    const summary = await runGenerate({ repoRoot, runTask: frozen.runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('frozen');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages.map((entry) => entry.slug).toSorted()).toEqual([
      'configuration',
      'getting-started',
      'troubleshooting'
    ]);
    for (const entry of index?.pages ?? []) {
      expect(await store.readPageShard({ locale: 'en', pageId: entry.id })).toBeDefined();
    }
  }, 60_000);

  // budgets.maxRunUsd defaults to 20, so an unconfigured run has real headroom but never runs uncapped.
  it('stays far under the default $20 cap and reports the total spend', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const { runTask, writeCalls } = scriptedRunner();
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });

    expect(writeCalls).toHaveLength(3);
    expect(summary.outcome).toBe('passed');
    expect(summary.pages).toHaveLength(3);
    expect(summary.spentUsd).toBeCloseTo(3 * PAGE_COST, 10);
    const journal = await createRunJournal(repoRoot, summary.runId);
    const events = await journal.readAll();
    expect(events.some((event) => event.type === 'run-frozen')).toBe(false);
  }, 60_000);
});
