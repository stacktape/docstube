import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore } from '../state/manifest-store.ts';
import { dirtyWorkingTreeWarning, readSourceFiles, runGenerate, unversionedReadSources } from './generate.ts';

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

  it('marks a run that READ an UNTRACKED (never-added) source file dirty, and NAMES it', async () => {
    // WARNING SAMPLES (wave 2b close, run-diagnostics finding): an untracked file makes porcelain
    // dirty, and the ls-files diff used to be skipped whenever porcelain had already spoken — so
    // the operator got only "the working tree is dirty" while the actionable detail (WHICH source
    // file this run read that no commit contains) was one cheap `git ls-files` away. The diff now
    // always runs, so the warning names the paths it claims to have.
    await writeFile(join(repoRoot, 'src', 'extra.ts'), 'export const extra = (): number => 1;\n');
    const { stdout } = await git('status', '--porcelain');
    expect(stdout).toContain('src/extra.ts');

    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect((await shardLineage())?.dirtyWorkingTree).toBe(true);
    const journalRaw = await readFile(join(repoRoot, '.docstube', 'runs', summary.runId, 'journal.jsonl'), 'utf8');
    expect(journalRaw).toContain('never the complete state');
    expect(journalRaw).toContain('read 1 source file that git does not version');
    expect(journalRaw).toContain('src/extra.ts');
    // …and the sentence describes what was actually observed: porcelain reported this file, so the
    // warning must not claim the tree "looked clean" (wave 2b close final).
    expect(journalRaw).toContain('reported the working tree dirty as well');
    expect(journalRaw).not.toContain('looked clean');
  }, 60_000);

  it('never promises samples it does not carry: the generic dirty-tree warning names no paths', () => {
    // The other half of the same rule — a warning with no unversioned sources to report describes
    // the porcelain cause and stops there, instead of advertising an example list it cannot fill.
    // …and it no longer hedges "(or has no HEAD)": an unknown state is its own sentence now
    // (wave 2b close final, run-diagnostics finding).
    const generic = dirtyWorkingTreeWarning('a'.repeat(40), [], 'dirty');
    expect(generic.message).toContain('the working tree is dirty');
    expect(generic.message).not.toContain('has no HEAD');
    expect(generic.message).not.toContain('git does not version');
    expect(generic.message).not.toContain('()');

    const unknown = dirtyWorkingTreeWarning('a'.repeat(40), [], 'unknown');
    expect(unknown.message).toContain('the working tree state is UNKNOWN');
    expect(unknown.message).not.toContain('git does not version');
    expect(unknown.message).not.toContain('()');

    const sampled = dirtyWorkingTreeWarning('a'.repeat(40), ['dist-dogfood/lib.ts']);
    expect(sampled.message).toContain('read 1 source file that git does not version');
    expect(sampled.message).toContain('dist-dogfood/lib.ts');
    // An ignored file IS invisible to porcelain, so this is the case that may say "looked clean".
    expect(sampled.message).toContain('so the tree looked clean');
  });

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
