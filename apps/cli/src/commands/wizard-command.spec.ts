import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    // launchRun is fire-and-forget (the dashboard follows the journal): wait for the emitted
    // route the shared assemble step writes.
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    const route = await vi.waitFor(() => readFile(routePath, 'utf8'), { timeout: 90_000, interval: 500 });

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

  it('still emits the site when the pipeline throws AFTER pages were persisted — routes match the new shards', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    // Run 1: an ordinary successful generate establishes the manifest and the rendered routes.
    const first = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask, toolDescriptors: [] } },
      output
    );
    await (first.launchRun?.('generate') ?? Promise.reject(new Error('no launchRun')));
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    await vi.waitFor(() => readFile(routePath, 'utf8'), { timeout: 90_000, interval: 500 });

    // Run 2: a target locale is configured, the writer produces an UPDATED page (two claims), and
    // the translate transport explodes — the pipeline throws AFTER the source page was persisted.
    await writeFile(
      join(repoRoot, 'docstube.yml'),
      'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\n' +
        'site:\n  title: Greeter Docs\nlocales:\n  source: en\n  targets: [de]\n'
    );
    const updatedMdx = mdx.replace(
      '<Claim id="c1">The library exposes a single `greet` function.</Claim>',
      '<Claim id="c1">The library exposes a single `greet` function.</Claim>\n\nAlso, <Claim id="c2">`greet` returns a string.</Claim>'
    );
    const failingRunTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      if (spec.kind === 'translate-page') {
        throw new Error('translate transport exploded');
      }
      if (spec.kind === 'review-page') {
        return scriptedRunTask(spec);
      }
      const base = await scriptedRunTask(spec);
      return { ...base, result: { type: 'mdx-ledger', mdx: updatedMdx, ledger: ledgerFor(updatedMdx) } };
    };
    const second = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: failingRunTask, toolDescriptors: [] } },
      output
    );
    await (second.launchRun?.('generate') ?? Promise.reject(new Error('no launchRun')));

    // The failure is surfaced AFTER emission — once the error line appears, the routes are final.
    await vi.waitFor(
      () => {
        if (!lines.some((line) => line.includes('background generate run failed'))) {
          throw new Error('run not failed yet');
        }
      },
      { timeout: 90_000, interval: 500 }
    );
    expect(lines.some((line) => line.includes('translate transport exploded'))).toBe(true);

    // The re-emitted route matches the NEW shard persisted before the throw (two claims), not the
    // pre-run rendering (one claim) — the exact drift the finally-shaped emission closes.
    const route = await readFile(routePath, 'utf8');
    expect(route).toContain('docstubeClaimsTotal: 2');
    expect(route).toContain('`greet` returns a string.');
    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.ledger?.claims).toHaveLength(2);
  }, 180_000);
});
