import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanClaimMarkers } from '@docstube/agent-runtime';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createControlPlaneCaller, createManifestStore, readOnboardingDraft } from '@docstube/core';
import { createWizardControlPlane } from './wizard-command.ts';
import type { CliOutput } from '../cli-output.ts';

// FIRST RUN, END TO END (PRODUCT §3.9.1/§3.9.2). The workspace starts with NO docstube.yml — the
// state the old wizard could not operate in — and one `setup.commit` call must leave it with
// config, an IA, a manifest, and a published site.

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
  if (spec.kind === 'preflight') {
    return { ...base, observedReads: [], result: { type: 'text', text: 'ok' } };
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

const configInput = {
  schemaVersion: 1,
  docType: 'external-library',
  projectContext: 'A greeter library.',
  personas: [{ id: 'app-developer', description: 'Builds apps' }],
  agents: { transport: 'claude-cli', model: 'sonnet' },
  site: { title: 'Greeter Docs' }
};
const iaInput = {
  schemaVersion: 1,
  tree: [{ title: 'Getting started', slug: 'getting-started', brief: 'Install and greet.' }]
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-first-run-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'src', 'greeter.ts'),
    'export const greet = (name: string): string => `Hi ${name}`;\n'
  );
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('first run through the control plane', () => {
  it('commits config and IA, then generates and publishes in one action', async () => {
    const lines: string[] = [];
    const output: CliOutput = { info: (message) => lines.push(message), error: (message) => lines.push(message) };
    const controlPlane = createWizardControlPlane(
      { workspaceDir: repoRoot, taskRunner: { runTask: scriptedRunTask, toolDescriptors: [] } },
      output
    );
    const caller = createControlPlaneCaller({ repoRoot, ...controlPlane });

    // The UI would land on setup here, because there is nothing to show on a dashboard.
    expect(await caller.setup.status()).toMatchObject({ hasConfig: false, initialSurface: 'setup' });

    // Setup autosaves as the user works; the draft is what the agent-backed steps run on.
    await caller.setup.saveDraft({ patch: { step: 4, agents: { transport: 'claude-cli', model: 'sonnet' } } });
    expect((await readOnboardingDraft(repoRoot))?.agents.model).toBe('sonnet');

    const result = await caller.setup.commit({ config: configInput, ia: iaInput });
    expect(result.runId).toMatch(/^run_/);
    expect(await readFile(join(repoRoot, 'docstube.yml'), 'utf8')).toContain('docType: external-library');
    expect(await readFile(join(repoRoot, 'ia.yml'), 'utf8')).toContain('getting-started');

    // Generation owns its own publish (staged-atomic publish): the route appears without any
    // separate emit step, which is what the wizard used to be missing.
    const routePath = join(repoRoot, 'docs-site', 'src', 'pages', 'getting-started.mdx');
    const route = await vi.waitFor(() => readFile(routePath, 'utf8'), { timeout: 90_000, interval: 500 });

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages).toHaveLength(1);
    const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
    expect(shard?.ledger?.claims).toHaveLength(1);
    expect(route).toContain(`docstubeClaimsTotal: ${shard?.ledger?.claims.length}`);

    // Config exists now, so the next open lands on the dashboard and the draft is gone.
    expect(await caller.setup.status()).toMatchObject({ hasConfig: true, initialSurface: 'dashboard' });
    expect(await readOnboardingDraft(repoRoot)).toBeUndefined();
  }, 180_000);

  it('runs the preflight through the injected task runner, never a live transport', async () => {
    const specs: AgentTaskSpec[] = [];
    const output: CliOutput = { info: () => undefined, error: () => undefined };
    const controlPlane = createWizardControlPlane(
      {
        workspaceDir: repoRoot,
        taskRunner: {
          runTask: async (spec) => {
            specs.push(spec);
            return scriptedRunTask(spec);
          },
          toolDescriptors: []
        }
      },
      output
    );
    const caller = createControlPlaneCaller({ repoRoot, ...controlPlane });
    await caller.setup.saveDraft({ patch: { agents: { transport: 'claude-cli', model: 'sonnet' } } });

    const result = await caller.setup.preflight();
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(specs.map((spec) => spec.kind)).toEqual(['preflight']);
  });
});
