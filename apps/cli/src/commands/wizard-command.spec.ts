import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cleanRiskCriticTranscript } from '@docstube/core';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore } from '@docstube/core';
import { createWizardControlPlane } from './wizard-command.ts';
import type { CliOutput } from '../cli-output.ts';

// The wizard regression (wave 2b close): its background generate updated content and shards
// WITHOUT re-emitting routes, so rendered claim counts could disagree with the shard during
// ordinary operation. The control-plane launchRun must end with the same assemble step the CLI
// generate command runs (emit-current-site.ts).

let repoRoot: string;

const mdx = `---
title: Getting started
description: Install and greet.
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>
`;

const ledgerFor = (source: string): WriterClaimLedger => ({
  schemaVersion: 1,
  claims: scanClaimMarkers(source).markers.map((marker) => ({
    markerId: marker.markerId,
    class: 'code-structure',
    predicate: marker.innerMdx,
    proposedEvidence: [],
    proposedSubscriptions: [{ kind: 'file-content', file: 'src/greeter.ts' }]
  }))
});

const scriptedRunTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
  const base = {
    schemaVersion: 1 as const,
    taskId: spec.id,
    cacheKey: 'test',
    transport: 'replay',
    model: 'scripted',
    observedReads: [{ file: 'src/greeter.ts', contentHash: '0'.repeat(64) }],
    usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
    stopReason: 'complete' as const,
    turns: []
  };
  if (spec.kind === 'assess-page-risk') {
    return cleanRiskCriticTranscript(spec);
  }
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
  return { ...base, result: { type: 'mdx-ledger', mdx, ledger: ledgerFor(mdx) } };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-wizard-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'greeter.ts'),
    'export const greet = (name: string): string => `Hi ${name}`;\n'
  );
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\nsite:\n  title: Greeter Docs\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install and greet.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('createWizardControlPlane', () => {
  it('launchRun(generate) emits the site after the run — routes exist and their counts match the shard', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
    const controlPlane = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask, toolDescriptors: [] } },
      output
    );

    const { runId } = await (controlPlane.launchRun?.('generate') ?? Promise.reject(new Error('no launchRun')));
    expect(runId).toMatch(/^run_/);

    // launchRun is fire-and-forget (the dashboard follows the journal), so wait for THE RUN — not
    // for a file it writes on the way. The publish replay emits routes BEFORE it commits the index
    // (publish-staging.ts), so polling for the route can win the race against the index write.
    await controlPlane.runsSettled();

    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    const route = await readFile(routePath, 'utf8');

    // Rendered counts agree with the shard's trust spine — the exact drift the fix closes.
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    const total = shard?.ledger?.claims.length ?? -1;
    const checked = shard?.ledger?.claims.filter((claim) => claim.correctness === 'checked').length ?? -1;
    expect(total).toBe(1);
    expect(route).toContain(`docstubeClaimsTotal: ${total}`);
    expect(route).toContain(`docstubeClaimsChecked: ${checked}`);
    // The matched MDX↔shard pair renders verified state, never the loud-unverified fallback.
    expect(route).not.toContain('docstubeUnverified');
    expect(lines.filter((line) => line.includes('unverified'))).toEqual([]);
  }, 120_000);

  // ONE RUN AT A TIME PER WORKSPACE (run-lock.ts). `launchRun` is fire-and-forget, so a second
  // call lands while the first run is still mid-plan — which is exactly what a double-clicked
  // "start run" does. Two pipelines would then share one `.docstube/staging/` area: they interleave
  // staged pages under a single `state.json` and both can reach the publish replay. The guard is a
  // lock FILE, so it holds whether the caller is the control plane, a test, or another process.
  it('launching a second run while the first is in flight starts nothing and follows the run already going', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
    let writePageCalls = 0;
    const countingRunTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'write-page') {
        writePageCalls += 1;
      }
      return scriptedRunTask(spec);
    };
    const controlPlane = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: countingRunTask, toolDescriptors: [] } },
      output
    );

    // Deliberately NOT awaited between the two: the first run is still going when the second lands.
    const first = await controlPlane.launchRun('generate');
    const second = await controlPlane.launchRun('generate');

    expect(first.started).toBe(true);
    // Not an error — the second caller is simply pointed at the run already in flight.
    expect(second.started).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(second.alreadyRunning?.runId).toBe(first.runId);

    await controlPlane.runsSettled();

    // ONE pipeline ran: one journal, one page written, and no failure reported to the UI channel.
    expect(await readdir(join(repoRoot, '.docstube', 'runs'))).toEqual([first.runId]);
    expect(writePageCalls).toBe(1);
    expect(lines.filter((line) => line.includes('run failed'))).toEqual([]);

    // The lock is gone once the run settled, so the workspace accepts the next run.
    await expect(readFile(join(repoRoot, '.docstube', 'run.lock'), 'utf8')).rejects.toThrow(/ENOENT/);
    const third = await controlPlane.launchRun('generate');
    expect(third.started).toBe(true);
    expect(third.runId).not.toBe(first.runId);
    await controlPlane.runsSettled();
  }, 180_000);

  // STAGED-ATOMIC PUBLISH (pipeline-v2 decision 3): the wizard's background generate publishes in
  // one step at the end of the plan, so a run that throws mid-plan leaves the routes exactly as the
  // last successful publish left them — and the wizard no longer emits a second time of its own.
  it('publishes nothing when the background generate throws mid-plan — the rendered routes are untouched', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    // Run 1: an ordinary successful generate establishes the manifest and the rendered routes.
    const first = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask, toolDescriptors: [] } },
      output
    );
    await (first.launchRun?.('generate') ?? Promise.reject(new Error('no launchRun')));
    // Run 1 must be fully settled before run 2 starts: two overlapping generates would share one
    // `.docstube/staging/` area, and the byte-comparison below would be against a mid-publish tree.
    await first.runsSettled();
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    const publishedRoute = await readFile(routePath, 'utf8');

    // Run 2: a SECOND page joins the IA, the writer produces an UPDATED first page (two claims),
    // and the WRITER transport explodes on the second page — the pipeline throws AFTER page one
    // was persisted. (A translator transport failure is nonblocking by design, impl-23 finding 4,
    // so it can no longer stand in for a run-level throw.)
    await writeFile(
      join(repoRoot, 'ia.yml'),
      'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install and greet.\n' +
        '  - title: Advanced\n    slug: advanced\n    brief: Go deeper.\n'
    );
    const updatedMdx = mdx.replace(
      '<Claim id="c1">The library exposes a single `greet` function.</Claim>',
      '<Claim id="c1">The library exposes a single `greet` function.</Claim>\n\nAlso, <Claim id="c2">`greet` returns a string.</Claim>'
    );
    let writePageCalls = 0;
    const failingRunTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'assess-page-risk') {
        return cleanRiskCriticTranscript(spec);
      }
      if (spec.kind === 'review-page') {
        return scriptedRunTask(spec);
      }
      const base = await scriptedRunTask(spec);
      if (spec.kind !== 'write-page') {
        return base;
      }
      writePageCalls += 1;
      if (writePageCalls > 1) {
        throw new Error('writer transport exploded');
      }
      return { ...base, result: { type: 'mdx-ledger', mdx: updatedMdx, ledger: ledgerFor(updatedMdx) } };
    };
    const second = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: failingRunTask, toolDescriptors: [] } },
      output
    );
    await (second.launchRun?.('generate') ?? Promise.reject(new Error('no launchRun')));
    await second.runsSettled();

    // The run is over and it reported its failure through the same output channel the UI reads.
    expect(lines.some((line) => line.includes('background generate run failed'))).toBe(true);
    expect(lines.some((line) => line.includes('writer transport exploded'))).toBe(true);

    // The route is byte-identical to run 1's publish, and the committed shard still carries the
    // ONE-claim ledger: the two-claim rewrite the crashed run produced is staged, never published.
    expect(await readFile(routePath, 'utf8')).toBe(publishedRoute);
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages).toHaveLength(1);
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.ledger?.claims).toHaveLength(1);
  }, 180_000);
});
