import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, PageShard, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { runGenerate } from './generate.ts';
import { rankPagesForRefinement, runRefine } from './refine.ts';

// refine picks the worst committed page (open flags first, lowest proven ratio next) and runs it
// back through the full page loop; a healed page loses its stale system flag.

let repoRoot: string;

const goodMdx = `---
title: Getting started
---

# Getting started

Greeting happens through one function.

## Usage

\`\`\`ts
const message: string = 'hello';
\`\`\`
`;

const badMdx = goodMdx.replace("const message: string = 'hello';", "const message: number = 'hello';");

// Wave 2b-i writer artifact: MDX plus a writer claim ledger (markerless fixtures carry an empty one).
const emptyLedger: WriterClaimLedger = { schemaVersion: 1, claims: [] };
const writeResult = (mdx: string): Transcript['result'] => ({ type: 'mdx-ledger', mdx, ledger: emptyLedger });

const makeRunner = (writeMdx: () => string) => {
  const writeCalls: string[] = [];
  const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
    const base: Omit<Transcript, 'result'> = {
      schemaVersion: 1,
      taskId: spec.id,
      cacheKey: 't',
      transport: 'replay',
      model: 's',
      turns: [],
      observedReads: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
      stopReason: 'complete'
    };
    if (spec.kind === 'review-page') {
      return { ...base, result: { type: 'structured', value: { persona: 'dev', criteria: [], findings: [] } } };
    }
    const mdx = writeMdx();
    writeCalls.push(spec.userPrompt);
    return { ...base, result: writeResult(mdx) };
  };
  return { runTask, writeCalls };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-refine-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), 'export const greet = (n: string): string => n;\n');
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'g', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: dev\n    description: d\nsite:\n  title: G\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Greet.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runRefine', () => {
  it('refines the flagged page and clears its stale system flag once verification passes', async () => {
    // Generate with a persistently bad writer → page ships flagged.
    const bad = makeRunner(() => badMdx);
    const generated = await runGenerate({ repoRoot, runTask: bad.runTask, toolDescriptors: [], maxAttemptsPerPage: 1 });
    expect(generated.pages[0]?.status).toBe('flagged');

    // Refine with a good writer → gate passes, the stale flag is superseded (not carried).
    const good = makeRunner(() => goodMdx);
    const summary = await runRefine({ repoRoot, runTask: good.runTask, toolDescriptors: [] });
    expect(summary.refined).toHaveLength(1);
    expect(summary.refined[0]).toMatchObject({ slug: 'getting-started', status: 'passed' });
    expect(summary.refined[0]!.provenBlocksAfter).toBeGreaterThan(summary.refined[0]!.provenBlocksBefore);
    expect(summary.outcome).toBe('passed');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.flags).toEqual([]);
    // Provable-only roll-up: with every code block passing its provers, the page badge reads
    // proven — claimless narrative no longer drags it to scored.
    expect(shard?.page.guarantee).toBe('proven');
  }, 60_000);

  it('respects --failed when nothing is flagged and rejects unknown targets', async () => {
    const good = makeRunner(() => goodMdx);
    await runGenerate({ repoRoot, runTask: good.runTask, toolDescriptors: [] });

    const noneFailed = await runRefine({ repoRoot, runTask: good.runTask, toolDescriptors: [], failedOnly: true });
    expect(noneFailed.refined).toEqual([]);

    await expect(runRefine({ repoRoot, runTask: good.runTask, toolDescriptors: [], target: 'nope' })).rejects.toThrow(
      /no generated page/u
    );
  }, 60_000);

  it('a plan-usage freeze journals run-frozen with the estimated spend and surfaces it in the summary', async () => {
    // Two pages so the freeze (checked only between candidates) can trip before candidate 2.
    await writeFile(
      join(repoRoot, 'ia.yml'),
      'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Greet.\n  - title: Usage\n    slug: usage\n    brief: Use it.\n'
    );
    const good = makeRunner(() => goodMdx);
    await runGenerate({ repoRoot, runTask: good.runTask, toolDescriptors: [] });

    // Subscription-style transport: tokens + plan usage, never a vendor-reported dollar. The plan
    // governor (default cap 80%) freezes the run; the journal must carry the token-derived
    // estimate, never spentUsd: 0.
    const planTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      const base: Omit<Transcript, 'result'> = {
        schemaVersion: 1,
        taskId: spec.id,
        cacheKey: 't',
        transport: 'replay',
        model: 's',
        turns: [],
        observedReads: [],
        usage: { inputTokens: 10_000, outputTokens: 10_000, planUsedPercent: 90, cacheHit: false },
        stopReason: 'complete'
      };
      if (spec.kind === 'review-page') {
        return { ...base, result: { type: 'structured', value: { persona: 'dev', criteria: [], findings: [] } } };
      }
      return { ...base, result: writeResult(goodMdx) };
    };
    const summary = await runRefine({ repoRoot, runTask: planTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('frozen');
    expect(summary.refined).toHaveLength(1);
    expect(summary.planUsedPercent).toBe(90);
    expect(summary.estimatedUsd).toBeGreaterThan(0);
    expect(summary.spentUsd).toBeUndefined();

    const journal = await createRunJournal(repoRoot, summary.runId);
    const events = await journal.readAll();
    const runFrozen = events.find((event) => event.type === 'run-frozen');
    expect(runFrozen).toMatchObject({ type: 'run-frozen', reason: expect.stringContaining('90%') });
    expect(runFrozen && 'spentUsd' in runFrozen ? runFrozen.spentUsd : 0).toBeGreaterThan(0);
  }, 60_000);
});

const tiedPage = (slug: string) => ({
  slug,
  shard: { generatedAt: '2026-01-01T00:00:00.000Z' } as PageShard,
  openFlags: 0,
  provenRatio: 0.5
});

describe('rankPagesForRefinement', () => {
  it('breaks full ties on slug so the order is deterministic regardless of input order', () => {
    const a = tiedPage('alpha');
    const b = tiedPage('beta');
    expect(rankPagesForRefinement([b, a]).map((entry) => entry.slug)).toEqual(['alpha', 'beta']);
    expect(rankPagesForRefinement([a, b]).map((entry) => entry.slug)).toEqual(['alpha', 'beta']);
  });
});
