import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cleanRiskCriticTranscript } from '@docstube/core';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { outputInventorySchema, publicationDecisionSchema } from '@docstube/contracts';
import { inventoryBindingHash, outputInventoryRelativePath, publicationDecisionRelativePath } from '@docstube/core';
import { runGenerateCommand } from './generate-command.ts';
import type { CliOutput } from '../cli-output.ts';

// STAGED-ATOMIC PUBLISH at the command boundary (pipeline-v2 decision 3): `generate` publishes its
// whole plan in one step or publishes nothing. What used to be tested here — re-emitting routes over
// whatever a crashed run had already persisted — no longer has a subject: a crashed run persists
// nothing readers can see.
//
// The throw vehicle is deliberately a WRITER transport failure on the second page: a TRANSLATOR
// transport failure is nonblocking by design (impl-23 finding 4) and no longer fails a run.

let repoRoot: string;

const mdx = `---
title: Getting started
description: Install and greet.
---

# Getting started

<Claim id="c1">The library exposes a single \`greet\` function.</Claim>
`;

const updatedMdx = mdx.replace(
  '<Claim id="c1">The library exposes a single `greet` function.</Claim>',
  '<Claim id="c1">The library exposes a single `greet` function.</Claim>\n\nAlso, <Claim id="c2">`greet` returns a string.</Claim>'
);

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

const scriptedRunTask = (pageMdx: string, writer: 'pass' | 'throw-on-first-page' | 'throw-on-second-page') => {
  let writePageCalls = 0;
  return async (spec: AgentTaskSpec): Promise<Transcript> => {
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
    if (spec.kind === 'translate-page') {
      return { ...base, result: { type: 'mdx', mdx: pageMdx } };
    }
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
    writePageCalls += 1;
    if (writer === 'throw-on-first-page' || (writer === 'throw-on-second-page' && writePageCalls > 1)) {
      throw new Error('writer transport exploded');
    }
    return { ...base, result: { type: 'mdx-ledger', mdx: pageMdx, ledger: ledgerFor(pageMdx) } };
  };
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-gen-cmd-'));
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

describe('runGenerateCommand', () => {
  // ONE PUBLISH PATH (pipeline-v2 decision 3): shard persistence and site emission are no longer
  // independent writes racing each other — routes, twins, canonical MDX, shards and the manifest
  // index are all produced by the single publish step at the end of the plan.
  it('publishes routes, twins, canonical MDX, shards and the index together', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    const result = await runGenerateCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask(mdx, 'pass'), toolDescriptors: [] } },
      output
    );
    expect(result.exitCode).toBe(0);
    expect(lines.some((line) => line.includes('site published to'))).toBe(true);

    const index = JSON.parse(await readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8'));
    expect(index.pages).toHaveLength(1);
    const entry = index.pages[0];
    // Everything the index advertises exists: canonical MDX, shard, rendered route, raw twin.
    expect(await readFile(join(repoRoot, 'docs-site', entry.path), 'utf8')).toContain('# Getting started');
    expect(
      await readFile(join(repoRoot, '.docstube', 'manifest', 'pages', 'en', `${entry.id}.json`), 'utf8')
    ).toContain(entry.id);
    expect(await readFile(join(repoRoot, 'docs-site', 'src', 'pages', `${entry.slug}.mdx`), 'utf8')).toContain(
      `docstubePageId: "${entry.id}"`
    );
    expect(await readFile(join(repoRoot, 'docs-site', 'public', `${entry.slug}.md`), 'utf8')).toContain(
      '# Getting started'
    );
    // The staging area cleans itself up on a successful publish.
    await expect(readFile(join(repoRoot, '.docstube', 'staging', 'state.json'), 'utf8')).rejects.toThrow(/ENOENT/);
  }, 180_000);

  // ONE RUN AT A TIME PER WORKSPACE (run-lock.ts). The CLI is the OTHER process in the scenario
  // that motivates the lock: `docstube generate` in a terminal while the local UI has a run going.
  // It cannot "follow" that run — it has nowhere to report to — so it refuses, names the run in
  // flight, and touches nothing.
  it('refuses to start while another run holds the workspace, and publishes nothing', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
    // A live holder: this process is alive and the heartbeat is fresh, so the lock is not stale.
    const now = new Date().toISOString();
    await mkdir(join(repoRoot, '.docstube'), { recursive: true });
    await writeFile(
      join(repoRoot, '.docstube', 'run.lock'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run_from_the_local_ui',
        mode: 'generate',
        pid: process.pid,
        host: hostname(),
        startedAt: now,
        heartbeatAt: now
      }),
      'utf8'
    );

    const result = await runGenerateCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask(mdx, 'pass'), toolDescriptors: [] } },
      output
    );
    expect(result.exitCode).toBe(1);
    // The message is actionable on its own: which run, which mode, which process.
    const refusal = lines.find((line) => line.includes('already in flight'));
    expect(refusal).toContain('run_from_the_local_ui');
    expect(refusal).toContain('generate');
    // A refused start is NOT a failed run: nothing was attempted, so nothing claims to have been
    // published and no manifest appeared.
    expect(lines.some((line) => line.includes('run failed'))).toBe(false);
    await expect(readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8')).rejects.toThrow(/ENOENT/);
    // The holder's lock is untouched — a refusal must never free someone else's lock.
    expect(JSON.parse(await readFile(join(repoRoot, '.docstube', 'run.lock'), 'utf8')).runId).toBe(
      'run_from_the_local_ui'
    );
  }, 60_000);

  // STAGED-ATOMIC PUBLISH (pipeline-v2 decision 3): a run that dies part-way through its plan
  // publishes NOTHING. The previous contract here was the opposite — pages landed one at a time, so
  // a crash had to re-emit the routes to match whatever had already been persisted. Now the
  // published tree is simply untouched, which is what makes `publishable: false` a fact.
  it('publishes nothing when the pipeline throws mid-plan — the previous site and manifest are untouched', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    // Run 1: an ordinary successful generate establishes the manifest and rendered routes.
    const first = await runGenerateCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask(mdx, 'pass'), toolDescriptors: [] } },
      output
    );
    expect(first.exitCode).toBe(0);
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    const publishedRoute = await readFile(routePath, 'utf8');
    expect(publishedRoute).toContain('docstubeClaimsTotal: 1');
    const publishedIndex = await readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8');
    const publishedMdx = await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8');

    // Run 2: a SECOND page joins the IA, the writer produces an UPDATED first page (two claims),
    // and the writer transport explodes on the second page — AFTER page one was persisted.
    await writeFile(
      join(repoRoot, 'ia.yml'),
      'schemaVersion: 1\ntree:\n  - title: Getting started\n    slug: getting-started\n    brief: Install and greet.\n' +
        '  - title: Advanced\n    slug: advanced\n    brief: Go deeper.\n'
    );
    await expect(
      runGenerateCommand(
        {
          workspaceDir: repoRoot,
          taskRunner: { runTask: scriptedRunTask(updatedMdx, 'throw-on-second-page'), toolDescriptors: [] }
        },
        output
      )
    ).rejects.toThrow('writer transport exploded');

    // BYTE-IDENTICAL: the crashed run rewrote page one into STAGING, never into the published tree,
    // so the route, the canonical MDX, and the manifest index are exactly what run 1 published.
    expect(lines.some((line) => line.includes('nothing was published'))).toBe(true);
    expect(await readFile(routePath, 'utf8')).toBe(publishedRoute);
    expect(await readFile(join(repoRoot, 'docs-site', 'content', 'en', 'getting-started.mdx'), 'utf8')).toBe(
      publishedMdx
    );
    expect(await readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8')).toBe(publishedIndex);
    // …and the second page the crashed run never finished has no route at all.
    await expect(readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'advanced.mdx'), 'utf8')).rejects.toThrow(
      /ENOENT/
    );
  }, 180_000);

  // PRODUCT §3.3: `--ci` is what makes a run accountable to the merge gate. The artifacts land
  // under `.docstube/runs/` (machine-local, never committed) and bind to the emitted tree.
  it('--ci emits a publication decision bound to the output inventory, and fails closed on an untrustworthy tree', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    const result = await runGenerateCommand(
      { workspaceDir: repoRoot, ci: true, taskRunner: { runTask: scriptedRunTask(mdx, 'pass'), toolDescriptors: [] } },
      output
    );
    expect(result.exitCode).toBe(0);

    const decision = publicationDecisionSchema.parse(
      JSON.parse(await readFile(join(repoRoot, publicationDecisionRelativePath), 'utf8'))
    );
    const inventory = outputInventorySchema.parse(
      JSON.parse(await readFile(join(repoRoot, outputInventoryRelativePath), 'utf8'))
    );

    expect(decision.candidateArtifactHash).toBe(inventoryBindingHash(inventory));
    expect(decision.execution).toBe('completed');
    expect(decision.plan).toEqual({ planned: 1, completed: 1, deferred: 0 });
    // The fixture workspace is not a git repository, so no commit can vouch for the checked bytes:
    // the gate blocks rather than assuming the evidence is bound to a revision.
    expect(decision.deterministicGate).toBe('blocked');
    expect(decision.publishable).toBe(false);
    expect(decision.reasonCodes).toContain('gate.blocked');
    // The emitted site and the manifest are declared; machine-local run state never is.
    expect(inventory.entries.some((entry) => entry.path === '.docstube/manifest/manifest.json')).toBe(true);
    expect(inventory.entries.some((entry) => entry.path.startsWith('.docstube/runs/'))).toBe(false);
  }, 180_000);

  it('--ci records a failed decision when the pipeline throws, instead of leaving CI with no artifact', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    await expect(
      runGenerateCommand(
        {
          workspaceDir: repoRoot,
          ci: true,
          taskRunner: { runTask: scriptedRunTask(mdx, 'throw-on-first-page'), toolDescriptors: [] }
        },
        output
      )
    ).rejects.toThrow('writer transport exploded');

    const decision = publicationDecisionSchema.parse(
      JSON.parse(await readFile(join(repoRoot, publicationDecisionRelativePath), 'utf8'))
    );
    expect(decision.execution).toBe('failed');
    expect(decision.publishable).toBe(false);
    expect(decision.autoMergeEligible).toBe(false);
    expect(decision.reasonCodes).toContain('execution.failed');
  }, 180_000);
});
