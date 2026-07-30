import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, ManifestIndex, Transcript } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { readRunLock, runLockPath, withRunLock } from '../state/run-lock.ts';
import { runGenerate } from './generate.ts';
import { collectOutputInventory } from './publication-decision.ts';
import { finishInterruptedPublish, readStagedRun, stagingDir } from './publish-staging.ts';
import { snapshotPublishedTree } from './publish-staging-test-support.ts';

// STAGED-ATOMIC PUBLISH (pipeline-v2 decision 3, PRODUCT §3.5 stage 10). The property under test is
// not "pages get written" — it is that a run either publishes its WHOLE plan or publishes nothing,
// and that an interruption during the publish itself is recoverable rather than corrupting.
//
// The scripted runner bills $0.80 per page (write $0.60 + review $0.20), so a $0.90 cap (freeze
// threshold $0.765) makes the freeze point deterministic: exactly one NEW page per run.

const WRITE_COST = 0.6;
const REVIEW_COST = 0.2;

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

// Records which page slugs the WRITER was actually billed for — the re-billing evidence.
const scriptedRunner = () => {
  const writtenSlugs: string[] = [];
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
            criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'Clear.' }],
            findings: []
          }
        }
      };
    }
    writtenSlugs.push(spec.id);
    return {
      ...baseTranscript(spec, WRITE_COST),
      turns: [{ role: 'assistant', blocks: [{ type: 'text', text: goodMdx }] }],
      result: { type: 'mdx-ledger', mdx: goodMdx, ledger: { schemaVersion: 1, claims: [] } }
    };
  };
  return { runTask, writtenSlugs };
};

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  );

// A pid that is definitely gone — confirmed dead right before it is used, because pids get reused.
const deadPid = (): number => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { pid } = spawnSync(process.execPath, ['-e', '']);
    if (pid !== undefined && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        return pid;
      }
    }
  }
  throw new Error('could not obtain a pid that is definitely gone');
};

const contentPath = (slug: string): string => join(repoRoot, 'docs-site', 'content', 'en', `${slug}.mdx`);
const indexPath = (): string => join(repoRoot, '.docstube', 'manifest', 'manifest.json');

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-staged-publish-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'greeter.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'greeter', type: 'module' }));
  await writeFile(join(repoRoot, 'ia.yml'), iaYaml);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('staged-atomic publish', () => {
  it('publishes content, shards and routes together — and commits the manifest index LAST', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const { runTask } = scriptedRunner();

    // The injected site publisher stands in for route/twin emission. It runs INSIDE the publish
    // replay, so what it can SEE at that moment is the ordering contract: every page's canonical
    // MDX and every shard already on disk, and the committed index NOT yet written — a partial
    // publish can therefore never advertise a page whose files are missing.
    const observed: { index: ManifestIndex; contentPresent: boolean; shardsPresent: boolean; indexPresent: boolean }[] =
      [];
    const store = createManifestStore(repoRoot, 'latest');
    const summary = await runGenerate({
      repoRoot,
      runTask,
      toolDescriptors: [],
      publishSite: async ({ index }) => {
        const shards = await Promise.all(
          index.pages.map((entry) => store.readPageShard({ locale: 'en', pageId: entry.id }))
        );
        observed.push({
          index,
          contentPresent: (await Promise.all(index.pages.map((entry) => exists(contentPath(entry.slug))))).every(
            Boolean
          ),
          shardsPresent: shards.every((shard) => shard !== undefined),
          indexPresent: await exists(indexPath())
        });
      }
    });

    expect(summary.outcome).toBe('passed');
    expect(summary.published).toBe(true);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.index.pages.map((entry) => entry.slug)).toEqual([
      'getting-started',
      'configuration',
      'troubleshooting'
    ]);
    expect(observed[0]?.contentPresent).toBe(true);
    expect(observed[0]?.shardsPresent).toBe(true);
    // THE COMMIT POINT: the index did not exist while routes were being rendered.
    expect(observed[0]?.indexPresent).toBe(false);

    // …and after the run everything is published together, with the staging area cleaned up.
    expect((await store.readIndex())?.pages).toHaveLength(3);
    expect(await exists(stagingDir(repoRoot))).toBe(false);
  }, 120_000);

  it('a frozen run publishes NOTHING and leaves the completed work staged', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const { runTask } = scriptedRunner();
    let publishSiteCalls = 0;
    const summary = await runGenerate({
      repoRoot,
      runTask,
      toolDescriptors: [],
      publishSite: async () => {
        publishSiteCalls += 1;
      }
    });

    expect(summary.outcome).toBe('frozen');
    expect(summary.published).toBe(false);
    // Emission is a STEP INSIDE publish, so a run that never publishes never emits either.
    expect(publishSiteCalls).toBe(0);
    expect(await exists(indexPath())).toBe(false);
    expect(await exists(contentPath('getting-started'))).toBe(false);

    const staged = await readStagedRun(repoRoot);
    expect(staged?.phase).toBe('staging');
    expect(staged?.pages.map((page) => page.slug)).toEqual(['getting-started']);
    expect(staged?.pages[0]?.mdxPath).toBe('content/en/getting-started.mdx');
    // The staged shard is real, readable state — it just is not published state.
    const stagedStore = createManifestStore(repoRoot, 'latest', {
      manifestDir: join(stagingDir(repoRoot), 'manifest')
    });
    expect(await stagedStore.readPageShard({ locale: 'en', pageId: staged?.pages[0]?.pageId ?? '' })).toBeDefined();
  }, 120_000);

  it('resumes staged work without re-billing: each page is written ONCE across three capped runs', async () => {
    // Every run keeps the SAME $0.90 cap, which is the real resume flow: rerun the same command.
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));

    const first = scriptedRunner();
    const one = await runGenerate({ repoRoot, runTask: first.runTask, toolDescriptors: [] });
    expect(one.outcome).toBe('frozen');
    expect(first.writtenSlugs).toHaveLength(1);

    // Run 2 reuses page 1 from staging for FREE — so its whole budget goes to page 2.
    const second = scriptedRunner();
    const two = await runGenerate({ repoRoot, runTask: second.runTask, toolDescriptors: [] });
    expect(two.outcome).toBe('frozen');
    expect(two.resumedPages).toBe(1);
    expect(second.writtenSlugs).toHaveLength(1);
    expect(await exists(indexPath())).toBe(false);

    // Run 3 reuses both, writes the last page, completes the plan and publishes everything at once.
    const third = scriptedRunner();
    const three = await runGenerate({ repoRoot, runTask: third.runTask, toolDescriptors: [] });
    expect(three.outcome).toBe('passed');
    expect(three.resumedPages).toBe(2);
    expect(third.writtenSlugs).toHaveLength(1);
    expect(three.published).toBe(true);

    // Three pages, three writer tasks total — nothing was generated (or billed) twice.
    const totalWrites = first.writtenSlugs.length + second.writtenSlugs.length + third.writtenSlugs.length;
    expect(totalWrites).toBe(3);

    const store = createManifestStore(repoRoot, 'latest');
    const index = await store.readIndex();
    expect(index?.pages.map((entry) => entry.slug).toSorted()).toEqual([
      'configuration',
      'getting-started',
      'troubleshooting'
    ]);
    for (const entry of index?.pages ?? []) {
      expect(await exists(contentPath(entry.slug))).toBe(true);
    }
    expect(await exists(stagingDir(repoRoot))).toBe(false);
  }, 180_000);

  it('discards staged work when the plan it was generated against changed', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const first = scriptedRunner();
    expect((await runGenerate({ repoRoot, runTask: first.runTask, toolDescriptors: [] })).outcome).toBe('frozen');
    const stagedPageId = (await readStagedRun(repoRoot))?.pages[0]?.pageId;
    expect(stagedPageId).toBeDefined();

    // The SOURCE changes. Reusing a page generated against the old tree would publish prose the
    // current source never supported, so the whole staging area is discarded and regenerated.
    await writeFile(
      join(repoRoot, 'src', 'greeter.ts'),
      `${fixtureSource}\nexport const farewell = (): string => 'bye';\n`
    );
    const second = scriptedRunner();
    const two = await runGenerate({ repoRoot, runTask: second.runTask, toolDescriptors: [] });
    expect(two.resumedPages).toBe(0);
    expect(second.writtenSlugs).toHaveLength(1);
  }, 180_000);

  it('an interrupted publish is detected and finished forward by the next run', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const { runTask } = scriptedRunner();
    // The publish replay dies in the middle: content and shards are written, the index is not.
    await expect(
      runGenerate({
        repoRoot,
        runTask,
        toolDescriptors: [],
        publishSite: async () => {
          throw new Error('route emission exploded');
        }
      })
    ).rejects.toThrow('route emission exploded');

    // The observable half-applied state — and the marker that makes it recoverable.
    expect(await exists(contentPath('getting-started'))).toBe(true);
    expect(await exists(indexPath())).toBe(false);
    const interrupted = await readStagedRun(repoRoot);
    expect(interrupted?.phase).toBe('publishing');
    expect(interrupted?.index?.pages).toHaveLength(3);

    // The next run's FIRST action replays the same publish to completion — never a mixed tree.
    const store = createManifestStore(repoRoot, 'latest');
    let recoveredIndex: ManifestIndex | undefined;
    const recovery = await finishInterruptedPublish({
      repoRoot,
      outDir: 'docs-site',
      store,
      publishSite: async ({ index }) => {
        recoveredIndex = index;
      }
    });
    expect(recovery.recovered).toBe(true);
    expect(recovery.runId).toBe(interrupted?.runId);
    expect(recoveredIndex?.pages).toHaveLength(3);
    expect((await store.readIndex())?.pages).toHaveLength(3);
    expect(await exists(stagingDir(repoRoot))).toBe(false);
  }, 120_000);

  // THE GUARD MUST NOT DEADLOCK AGAINST A CORPSE (run-lock.ts). A process that died mid-publish
  // leaves BOTH a staging area in the `publishing` phase and a run lock nobody released. The next
  // run is the only thing that can repair the first — so if the lock outlived its owner, the
  // workspace would be wedged in exactly the state that most needs a run.
  it('a crashed run leaves a lock AND a half-published tree — the next run takes the lock and repairs forward', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const first = scriptedRunner();
    await expect(
      runGenerate({
        repoRoot,
        runTask: first.runTask,
        toolDescriptors: [],
        publishSite: async () => {
          throw new Error('the machine lost power mid-publish');
        }
      })
    ).rejects.toThrow('the machine lost power mid-publish');
    expect((await readStagedRun(repoRoot))?.phase).toBe('publishing');

    // …and the dead process's lock, still on disk, pointing at a pid that no longer exists.
    const now = new Date().toISOString();
    await mkdir(join(repoRoot, '.docstube'), { recursive: true });
    await writeFile(
      runLockPath(repoRoot),
      `${JSON.stringify({
        schemaVersion: 1,
        runId: 'run_crashed',
        mode: 'generate',
        pid: deadPid(),
        host: hostname(),
        startedAt: now,
        heartbeatAt: now
      })}\n`,
      'utf8'
    );

    const second = scriptedRunner();
    const two = await withRunLock({ repoRoot, mode: 'generate' }, (handle) =>
      runGenerate({ repoRoot, runTask: second.runTask, toolDescriptors: [], runId: handle.runId })
    );
    expect(two.outcome).toBe('passed');
    expect((await createManifestStore(repoRoot, 'latest').readIndex())?.pages).toHaveLength(3);
    expect(await exists(stagingDir(repoRoot))).toBe(false);
    // The run finished, so the workspace is free again — no lock outlives its run.
    expect(await readRunLock(repoRoot)).toBeUndefined();
  }, 180_000);

  it('a run that finds an interrupted publish repairs it before doing anything else, and journals it', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const first = scriptedRunner();
    await expect(
      runGenerate({
        repoRoot,
        runTask: first.runTask,
        toolDescriptors: [],
        publishSite: async () => {
          throw new Error('route emission exploded');
        }
      })
    ).rejects.toThrow('route emission exploded');

    const second = scriptedRunner();
    const two = await runGenerate({ repoRoot, runTask: second.runTask, toolDescriptors: [] });
    expect(two.outcome).toBe('passed');

    const journal = await createRunJournal(repoRoot, two.runId);
    const events = await journal.readAll();
    const repaired = events.some(
      (event) =>
        event.type === 'findings' &&
        event.findings.some((finding) => finding.check === 'staged-publish' && finding.message.includes('interrupted'))
    );
    expect(repaired).toBe(true);
    expect((await createManifestStore(repoRoot, 'latest').readIndex())?.pages).toHaveLength(3);
  }, 180_000);

  it('staged work is never a declared output — the CI inventory (and therefore the commit) cannot see it', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const { runTask } = scriptedRunner();
    expect((await runGenerate({ repoRoot, runTask, toolDescriptors: [] })).outcome).toBe('frozen');
    expect(await exists(stagingDir(repoRoot))).toBe(true);

    const inventory = await collectOutputInventory({ repoRoot, outDir: 'docs-site' });
    expect(inventory.entries.some((entry) => entry.path.startsWith('.docstube/staging'))).toBe(false);
  }, 120_000);

  // `docstube preview` serves `<outDir>/dist`, and the local UI reads the committed manifest — both
  // through the published tree only. That is a STRUCTURAL property: the staging path is known to
  // exactly one module (plus the pipeline that drives it and core's public export list), so no
  // reader surface can grow a peek at unpublished work without this test failing.
  it('only the publisher knows the staging path — no reader surface can reach staged content', async () => {
    const roots = [join(process.cwd(), 'packages'), join(process.cwd(), 'apps')];
    const allowed = new Set([
      'packages/core/src/pipeline/publish-staging.ts',
      'packages/core/src/pipeline/generate.ts',
      'packages/core/src/core.ts'
    ]);
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') {
            await walk(absolute);
          }
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.spec.') || entry.name.includes('test-support')) {
          continue;
        }
        const relativePath = relative(process.cwd(), absolute).split(sep).join('/');
        if (allowed.has(relativePath)) {
          continue;
        }
        const text = await readFile(absolute, 'utf8');
        // The staging API itself — not the string, which the CLI legitimately NAMES in the
        // frozen-run message so an operator knows where their unpublished work went.
        if (/stagingDir\(|openPublishStaging|readStagedRun|discardStaging|finishInterruptedPublish/u.test(text)) {
          offenders.push(relativePath);
        }
      }
    };
    for (const root of roots) {
      await walk(root);
    }
    expect(offenders).toEqual([]);
  }, 60_000);

  it('the published tree a reader sees is byte-identical across a freeze', async () => {
    // Publish a complete site first, then freeze a rerun of the same plan.
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml());
    const full = scriptedRunner();
    await runGenerate({ repoRoot, runTask: full.runTask, toolDescriptors: [] });
    const before = await snapshotPublishedTree(repoRoot);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    // A new page joins the plan, and the budget freezes the run before it can finish.
    await writeFile(
      join(repoRoot, 'ia.yml'),
      `${iaYaml}  - title: Recipes\n    slug: recipes\n    brief: Common recipes.\n`
    );
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml(0.9));
    const frozen = scriptedRunner();
    const summary = await runGenerate({ repoRoot, runTask: frozen.runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('frozen');

    expect(await snapshotPublishedTree(repoRoot)).toEqual(before);
    // The new page exists only in staging — no route, no content, no index entry.
    expect(await exists(contentPath('recipes'))).toBe(false);
    expect(await readFile(indexPath(), 'utf8')).toBe(before['.docstube/manifest/manifest.json']);
  }, 180_000);
});
