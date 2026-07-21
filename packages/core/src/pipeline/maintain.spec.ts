import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { contentHash } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { runGenerate } from './generate.ts';
import { runMaintain } from './maintain.ts';

// Maintain/refresh over a real temp repo: generate first (scripted writer + passing reviewers),
// then refresh and assert which pages regenerate. CI never calls a live model. Writer tasks
// return the wave 2b-i artifact: MDX plus a writer claim ledger (markerless pages carry an
// empty ledger).

const emptyLedger: WriterClaimLedger = { schemaVersion: 1, claims: [] };
const writeResult = (mdx: string): Transcript['result'] => ({ type: 'mdx-ledger', mdx, ledger: emptyLedger });

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

const configYaml = (coverage: 'on' | 'off'): string => `schemaVersion: 1
docType: external-library
projectContext: A tiny greeting library.
personas:
  - id: app-developer
    description: Builds apps using the library
site:
  title: Greeter Docs
coverage: '${coverage}'
`;

const iaYaml = `schemaVersion: 1
tree:
  - title: Getting started
    slug: getting-started
    brief: Install the library and greet someone.
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

// Observed reads must carry the REAL content hash of the fixture file: refresh recomputes the
// hash from disk and regenerates on any mismatch (bias rule), so a fake hash would make every
// refresh look affected.
const baseTranscript = (spec: AgentTaskSpec, observedContent: string): Omit<Transcript, 'result' | 'turns'> => ({
  schemaVersion: 1,
  taskId: spec.id,
  cacheKey: 'test',
  transport: 'replay',
  model: 'scripted',
  observedReads: [{ file: 'src/greeter.ts', contentHash: contentHash(observedContent) }],
  usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
  stopReason: 'complete'
});

const passingReview = (spec: AgentTaskSpec, observedContent: string): Transcript => ({
  ...baseTranscript(spec, observedContent),
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
});

// Dispatches by task kind: write-page consumes the scripted MDX queue; review-page passes.
const scriptedRunner = (writeResponses: string[], observedContent: string) => {
  const remaining = [...writeResponses];
  const writeCalls: AgentTaskSpec[] = [];
  const reviewCalls: AgentTaskSpec[] = [];
  const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
    if (spec.kind === 'review-page') {
      reviewCalls.push(spec);
      return passingReview(spec, observedContent);
    }
    writeCalls.push(spec);
    const mdx = remaining.shift();
    if (mdx === undefined) {
      throw new Error('scripted runner exhausted');
    }
    return {
      ...baseTranscript(spec, observedContent),
      turns: [{ role: 'assistant', blocks: [{ type: 'text', text: mdx }] }],
      result: writeResult(mdx)
    };
  };
  return { runTask, writeCalls, reviewCalls };
};

const generateFixtureDocs = async () => {
  const { runTask } = scriptedRunner([goodMdx], fixtureSource);
  const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
  expect(summary.outcome).toBe('passed');
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-refresh-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(join(repoRoot, 'docstube.yml'), configYaml('off'));
  await writeFile(join(repoRoot, 'ia.yml'), iaYaml);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('runMaintain', () => {
  it('fails with a clear error when no manifest exists yet', async () => {
    const { runTask } = scriptedRunner([], fixtureSource);
    await expect(runMaintain({ repoRoot, runTask, toolDescriptors: [] })).rejects.toThrow(/docstube generate/);
  });

  it('regenerates nothing when the source is unchanged', async () => {
    await generateFixtureDocs();

    const { runTask, writeCalls, reviewCalls } = scriptedRunner([], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.outcome).toBe('passed');
    expect(summary.regenerated).toEqual([]);
    expect(summary.unchangedCount).toBe(1);
    expect(writeCalls).toHaveLength(0);
    expect(reviewCalls).toHaveLength(0);
  }, 120_000);

  it('regenerates the page when an observed source file changes signature', async () => {
    await generateFixtureDocs();

    const changedSource = fixtureSource.replace('name: string;', 'name: string;\n  title?: string;');
    await writeFile(join(repoRoot, 'src', 'greeter.ts'), changedSource);

    const { runTask, writeCalls, reviewCalls } = scriptedRunner([goodMdx], changedSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.regenerated).toEqual(['getting-started']);
    expect(summary.unchangedCount).toBe(0);
    expect(writeCalls).toHaveLength(1);
    expect(reviewCalls).toHaveLength(1);
    expect(summary.outcome).toBe('passed');

    // The regenerated page keeps its identity across the refresh.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages).toHaveLength(1);
    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('# Getting started');
  }, 120_000);

  it('regenerates when an observed-read file is deleted (bias rule: uncertain ⇒ regenerate)', async () => {
    await generateFixtureDocs();

    await rm(join(repoRoot, 'src', 'greeter.ts'));

    const { runTask, writeCalls } = scriptedRunner([goodMdx], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.regenerated).toEqual(['getting-started']);
    expect(writeCalls).toHaveLength(1);
  }, 120_000);

  it("raises a coverage flag when coverage is 'on' and public symbols are undocumented", async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml('on'));
    await generateFixtureDocs();

    // A new exported symbol nobody's provenance references.
    await writeFile(
      join(repoRoot, 'src', 'farewell.ts'),
      'export const farewell = (name: string): string => `Bye, ${name}`;\n'
    );

    const { runTask, writeCalls } = scriptedRunner([], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    // The new file was never an observed read, so the page itself is unaffected.
    expect(writeCalls).toHaveLength(0);
    expect(summary.outcome).toBe('flagged');

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const coverageFlag = index?.systemFlags.find((flag) => flag.kind === 'coverage');
    expect(coverageFlag?.status).toBe('open');
    expect(coverageFlag?.detail).toContain('farewell');
    expect(index?.coverage?.publicSymbols).toBeGreaterThan(0);
  }, 120_000);

  it('flags a structural change when an indexed page loses its IA node, without deleting it', async () => {
    await generateFixtureDocs();

    await writeFile(
      join(repoRoot, 'ia.yml'),
      `schemaVersion: 1
tree:
  - title: Overview
    slug: overview
    brief: What the library does.
`
    );

    const { runTask, writeCalls } = scriptedRunner([], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    expect(writeCalls).toHaveLength(0);
    expect(summary.outcome).toBe('flagged');
    // Structure is a human decision: the page survives in the index and on disk.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages.map((entry) => entry.slug)).toEqual(['getting-started']);
    expect(index?.systemFlags.some((flag) => flag.kind === 'structural-change')).toBe(true);
    const mdxOnDisk = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');
    expect(mdxOnDisk).toContain('# Getting started');
    // The new node is surfaced as a warning, not silently generated.
    expect(summary.warnings.some((warning) => warning.includes('overview'))).toBe(true);
  }, 120_000);

  it('never stacks duplicate system flags across refreshes and resolves them once the condition heals', async () => {
    await generateFixtureDocs();

    const missingNodeIa = `schemaVersion: 1
tree:
  - title: Overview
    slug: overview
    brief: What the library does.
`;
    await writeFile(join(repoRoot, 'ia.yml'), missingNodeIa);

    // First refresh: the indexed page lost its IA node — one open structural-change flag.
    await runMaintain({ repoRoot, runTask: scriptedRunner([], fixtureSource).runTask, toolDescriptors: [] });
    const store = createManifestStore(repoRoot, 'latest');
    let index = await store.readIndex();
    expect(index?.systemFlags.filter((flag) => flag.kind === 'structural-change')).toHaveLength(1);

    // Second refresh with the SAME condition: the open flag is not duplicated, and the run stays
    // flagged because the docs still carry it.
    const second = await runMaintain({
      repoRoot,
      runTask: scriptedRunner([], fixtureSource).runTask,
      toolDescriptors: []
    });
    index = await store.readIndex();
    expect(index?.systemFlags.filter((flag) => flag.kind === 'structural-change')).toHaveLength(1);
    expect(index?.systemFlags[0]?.status).toBe('open');
    expect(second.outcome).toBe('flagged');

    // The IA node returns: the condition no longer holds, so the flag resolves and the run passes.
    await writeFile(join(repoRoot, 'ia.yml'), iaYaml);
    const third = await runMaintain({
      repoRoot,
      runTask: scriptedRunner([], fixtureSource).runTask,
      toolDescriptors: []
    });
    index = await store.readIndex();
    expect(index?.systemFlags.filter((flag) => flag.kind === 'structural-change')).toHaveLength(1);
    expect(index?.systemFlags[0]?.status).toBe('resolved');
    expect(third.outcome).toBe('passed');
  }, 180_000);

  it('reports flagged when a carried (unchanged) page still ships open non-tribal flags', async () => {
    // Generate with a persistently failing persona review: the page ships flagged with an OPEN
    // flag while its MDX passes every deterministic verifier.
    const failingReviewTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'review-page') {
        return {
          ...baseTranscript(spec, fixtureSource),
          observedReads: [],
          turns: [],
          result: {
            type: 'structured',
            value: {
              persona: 'app-developer',
              criteria: [{ criterion: 'audience-fit', outcome: 'not-met', reasoning: 'Assumes internal context.' }],
              findings: [
                {
                  source: 'review',
                  check: 'audience-fit',
                  severity: 'error',
                  message: 'The page assumes repository-internal context an app developer cannot have.'
                }
              ]
            }
          }
        };
      }
      return {
        ...baseTranscript(spec, fixtureSource),
        turns: [{ role: 'assistant', blocks: [{ type: 'text', text: goodMdx }] }],
        result: writeResult(goodMdx)
      };
    };
    const generated = await runGenerate({
      repoRoot,
      runTask: failingReviewTask,
      toolDescriptors: [],
      maxAttemptsPerPage: 1
    });
    expect(generated.outcome).toBe('flagged');

    // Refresh with nothing changed: the page is carried, not regenerated — but its standing open
    // flag must keep the run flagged, or the auto-merge gate reads a defective site as clean.
    const { runTask, writeCalls } = scriptedRunner([], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });
    expect(writeCalls).toHaveLength(0);
    expect(summary.unchangedCount).toBe(1);
    expect(summary.outcome).toBe('flagged');
  }, 120_000);

  it('regenerates when a provenance source symbol hash disappears from the HEAD codemap', async () => {
    await generateFixtureDocs();

    // Inject a symbol source with a hash no codemap will ever contain — the dependency vanished.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const pageId = index?.pages[0]?.id ?? '';
    const shard = await store.readPageShard({ locale: 'en', pageId });
    expect(shard).toBeDefined();
    if (shard === undefined) {
      throw new Error('expected a shard');
    }
    await store.writePageShard({
      ...shard,
      page: {
        ...shard.page,
        provenance: {
          ...shard.page.provenance,
          sources: [{ symbol: `ts:${'f'.repeat(64)}`, file: 'src/greeter.ts', commit: shard.sourceCommit }]
        }
      }
    });

    const { runTask, writeCalls } = scriptedRunner([goodMdx], fixtureSource);
    const summary = await runMaintain({ repoRoot, runTask, toolDescriptors: [] });

    expect(summary.regenerated).toEqual(['getting-started']);
    expect(writeCalls).toHaveLength(1);
  }, 120_000);
});
