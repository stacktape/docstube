import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSourceRevision } from './generate.ts';

const execFileAsync = promisify(execFile);

// Finding 7: fingerprinting/codemap read the WORKING TREE, so a run must never claim HEAD
// contained bytes it may not have. Clean tree → HEAD, no marker; dirty tree or no HEAD → the
// honest dirtyWorkingTree marker.

const git = (cwd: string, ...args: string[]) =>
  execFileAsync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args], { cwd });

let repoRoot: string | undefined;

afterEach(async () => {
  if (repoRoot !== undefined) {
    await rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  }
});

describe('resolveSourceRevision', () => {
  it('marks a non-git directory (no HEAD) as dirty with the zero commit', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-rev-'));
    const state = await resolveSourceRevision(repoRoot);
    expect(state).toEqual({ commit: '0'.repeat(40), dirtyWorkingTree: true });
  });

  it('keeps a clean committed tree unmarked (unchanged behavior)', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-rev-'));
    await writeFile(join(repoRoot, 'a.txt'), 'one\n');
    await git(repoRoot, 'init');
    await git(repoRoot, 'add', '.');
    await git(repoRoot, 'commit', '-m', 'initial');
    const state = await resolveSourceRevision(repoRoot);
    expect(state.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(state.dirtyWorkingTree).toBe(false);
  });

  it('marks a tree with uncommitted changes dirty while still recording HEAD', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-rev-'));
    await writeFile(join(repoRoot, 'a.txt'), 'one\n');
    await git(repoRoot, 'init');
    await git(repoRoot, 'add', '.');
    await git(repoRoot, 'commit', '-m', 'initial');
    await writeFile(join(repoRoot, 'a.txt'), 'two\n');
    const state = await resolveSourceRevision(repoRoot);
    expect(state.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(state.dirtyWorkingTree).toBe(true);
  });
});
