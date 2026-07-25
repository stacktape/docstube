import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { readSourceFiles, runGenerate, unversionedReadSources } from './generate.ts';

// UNVERSIONED SOURCES ARE UNCOMMITTED (wave 2b close — the spine finding). `git status --porcelain`
// reports nothing about IGNORED files, while the codemap walker scans them (this repository's own
// gitignored dist-dogfood/**/*.ts is the live reproduction), so a run could bind evidence to bytes
// that exist in no commit while the tree reported perfectly clean. The dirtyWorkingTree lineage
// marker is what gates the complete state everywhere it is rendered (proof-projection.spec.ts and
// review.spec.tsx prove that half), so a run over unversioned sources must set it.

const execFileAsync = promisify(execFile);

let repoRoot: string;

const git = (...args: string[]) =>
  execFileAsync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repoRoot
  });

const goodMdx = `---
title: Getting started
---

# Getting started

Greeting happens through one function.
`;

const emptyLedger: WriterClaimLedger = { schemaVersion: 1, claims: [] };

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
  return { ...base, result: { type: 'mdx-ledger', mdx: goodMdx, ledger: emptyLedger } };
};

const shardLineage = async () => {
  const store = createManifestStore(repoRoot, 'latest');
  const index = await store.readIndex();
  const shard = await store.readPageShard({ locale: 'en', pageId: index?.pages[0]?.id ?? '' });
  return shard?.provenance?.lineage;
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-unversioned-'));
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
  // Machine-local state, emitted output, and a build directory the walker still scans — all
  // committed up front so no later test step has to touch a TRACKED file (which would make
  // porcelain dirty and mask the ignored-file path under test).
  await writeFile(join(repoRoot, '.gitignore'), '.docstube/\ndocs-site/\ndist-dogfood/\n');
  await git('init');
  await git('add', '.');
  await git('commit', '-m', 'initial');
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('unversioned read sources', () => {
  it('leaves a run over fully tracked, clean sources unmarked — the page stays complete-eligible', async () => {
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('passed');
    expect((await shardLineage())?.dirtyWorkingTree).toBeUndefined();
  }, 60_000);

  it('marks a run that READ an IGNORED source file dirty, though `git status` reports clean', async () => {
    await mkdir(join(repoRoot, 'dist-dogfood'), { recursive: true });
    await writeFile(join(repoRoot, 'dist-dogfood', 'lib.ts'), 'export const shipped = (): number => 41;\n');
    // The tree still reports clean: porcelain omits ignored files entirely.
    const { stdout } = await git('status', '--porcelain');
    expect(stdout.trim()).toBe('');

    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect((await shardLineage())?.dirtyWorkingTree).toBe(true);

    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', summary.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('git does not version');
    expect(journalRaw).toContain('dist-dogfood/lib.ts');
    // The reader-facing consequence is stated in the same words as every other dirty cause.
    expect(journalRaw).toContain('never the complete state');
  }, 60_000);

  it('marks a run that READ an UNTRACKED (never-added) source file dirty', async () => {
    await writeFile(join(repoRoot, 'src', 'extra.ts'), 'export const extra = (): number => 1;\n');
    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect((await shardLineage())?.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', summary.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('never the complete state');
  }, 60_000);

  it('resolves trackedness over the BOUNDED read set and excludes docstube’s own outputs', async () => {
    await mkdir(join(repoRoot, 'dist-dogfood'), { recursive: true });
    await writeFile(join(repoRoot, 'dist-dogfood', 'lib.ts'), 'export const shipped = (): number => 41;\n');
    await mkdir(join(repoRoot, 'docs-site', 'content'), { recursive: true });
    await writeFile(join(repoRoot, 'docs-site', 'content', 'page.mdx'), '# generated\n');

    // Tracked source in, ignored source out, docstube's own (untracked) output never counted.
    expect(
      await unversionedReadSources({
        repoRoot,
        files: ['src/greeter.ts', 'dist-dogfood/lib.ts', 'docs-site/content/page.mdx', '.docstube/manifest/index.yml'],
        ownOutputPrefixes: ['docs-site', '.docstube']
      })
    ).toEqual(['dist-dogfood/lib.ts']);

    // An empty read set never shells out to git at all.
    expect(await unversionedReadSources({ repoRoot, files: [] })).toEqual([]);
  });

  it('collects the read set from parsed symbols, whole-file fallbacks, and observed reads', () => {
    expect(
      readSourceFiles({
        codemap: { symbols: [{ file: 'src/a.ts' }, { file: 'src/a.ts' }, { file: 'src/b.ts' }] },
        fingerprints: { unparsedFiles: [{ file: 'README.md' }, { file: 'src/b.ts' }] },
        observedReads: [{ file: 'dist-dogfood/lib.ts' }]
      })
    ).toEqual(['src/a.ts', 'src/b.ts', 'README.md', 'dist-dogfood/lib.ts']);
  });
});
