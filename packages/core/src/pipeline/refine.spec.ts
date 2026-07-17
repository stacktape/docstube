import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runGenerate } from './generate.ts';
import { runRefine } from './refine.ts';

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
    if (spec.kind === 'audit-extract-claims') {
      return { ...base, result: { type: 'structured', value: { claims: [] } } };
    }
    const mdx = writeMdx();
    writeCalls.push(spec.userPrompt);
    return { ...base, result: { type: 'mdx', mdx } };
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
});
