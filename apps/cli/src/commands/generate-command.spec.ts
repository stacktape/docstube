import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { runGenerateCommand } from './generate-command.ts';
import type { CliOutput } from '../cli-output.ts';

// EMISSION AFTER PARTIAL FAILURE (wave 2b close): the pipeline can throw AFTER pages were
// persisted (translation/transport errors). The generate command must still run the shared
// assemble step over the consistent persisted state before surfacing the run error — otherwise an
// old rendered route keeps disagreeing with the new shard.

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

const scriptedRunTask =
  (pageMdx: string, translate: 'pass' | 'throw') =>
  async (spec: AgentTaskSpec): Promise<Transcript> => {
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
      if (translate === 'throw') {
        throw new Error('translate transport exploded');
      }
      return { ...base, result: { type: 'mdx', mdx: pageMdx } };
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
    return { ...base, result: { type: 'mdx-ledger', mdx: pageMdx, ledger: ledgerFor(pageMdx) } };
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
  it('emits the persisted state even when the pipeline throws after pages landed, then surfaces the run error', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };

    // Run 1: an ordinary successful generate establishes the manifest and rendered routes.
    const first = await runGenerateCommand(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask(mdx, 'pass'), toolDescriptors: [] } },
      output
    );
    expect(first.exitCode).toBe(0);
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    expect(await readFile(routePath, 'utf8')).toContain('docstubeClaimsTotal: 1');

    // Run 2: a target locale is configured, the writer produces an UPDATED page (two claims), and
    // the translate transport explodes AFTER the source page was persisted.
    await writeFile(
      join(repoRoot, 'docstube.yml'),
      'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\n' +
        'site:\n  title: Greeter Docs\nlocales:\n  source: en\n  targets: [de]\n'
    );
    await expect(
      runGenerateCommand(
        { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask(updatedMdx, 'throw'), toolDescriptors: [] } },
        output
      )
    ).rejects.toThrow('translate transport exploded');

    // The finally-shaped emission ran before the error escaped: the route matches the NEW shard
    // (two claims), never the stale pre-run rendering.
    expect(lines.some((line) => line.includes('re-emitted'))).toBe(true);
    const route = await readFile(routePath, 'utf8');
    expect(route).toContain('docstubeClaimsTotal: 2');
    expect(route).toContain('`greet` returns a string.');
  }, 180_000);
});
