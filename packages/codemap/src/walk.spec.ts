import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walkRepoFiles } from './walk.ts';

const execFileAsync = promisify(execFile);

// The walk skips node_modules/dist/etc., so this fixture tree cannot live committed in the repo
// (node_modules is git-ignored). Built in a temp dir instead. A temp dir is also NOT a git
// repository, which is exactly the git-unavailable fallback path this suite pins.
let repoRoot = '';

const writeInto = async (root: string, relativePath: string, content?: string): Promise<void> => {
  const absolute = join(root, ...relativePath.split('/'));
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, content ?? `// ${relativePath}\n`, 'utf8');
};

const writeFixture = (relativePath: string): Promise<void> => writeInto(repoRoot, relativePath);

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-walk-'));
  await writeFixture('src/a.ts');
  await writeFixture('src/nested/b.ts');
  await writeFixture('src/readme.md');
  await writeFixture('node_modules/pkg/skip.ts');
  await writeFixture('dist/skip.ts');
  await writeFixture('build/skip.ts');
  await writeFixture('coverage/skip.ts');
  await writeFixture('.hidden/skip.ts');
  await writeFixture('.docstube/skip.ts');
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe('walkRepoFiles', () => {
  it('returns matching files as sorted repo-relative POSIX paths', async () => {
    const files = await walkRepoFiles({ repoRoot, extensions: ['.ts'] });
    expect(files).toEqual(['src/a.ts', 'src/nested/b.ts']);
    for (const file of files) {
      expect(file).not.toContain('\\');
    }
  });

  it('skips node_modules, dist, build, coverage, and hidden directories', async () => {
    const files = await walkRepoFiles({ repoRoot, extensions: ['.ts'] });
    expect(files.some((file) => file.includes('node_modules') || file.includes('dist'))).toBe(false);
    expect(files.some((file) => file.startsWith('.'))).toBe(false);
  });

  it('respects the ignore list for directories and exact files', async () => {
    expect(await walkRepoFiles({ repoRoot, extensions: ['.ts'], ignore: ['src/nested'] })).toEqual(['src/a.ts']);
    expect(await walkRepoFiles({ repoRoot, extensions: ['.ts'], ignore: ['src/a.ts'] })).toEqual(['src/nested/b.ts']);
  });

  it('filters by extension', async () => {
    expect(await walkRepoFiles({ repoRoot, extensions: ['.md'] })).toEqual(['src/readme.md']);
  });

  // The git-unavailable fallback: a `.gitignore` sitting in a directory git cannot be asked about
  // has no effect, and the walk still returns files rather than crashing or going empty.
  it('falls back to the hardcoded skips when the directory is not a git repository', async () => {
    const fallbackRoot = await mkdtemp(join(tmpdir(), 'docstube-walk-nogit-'));
    try {
      await writeInto(fallbackRoot, '.gitignore', 'src/a.ts\ngenerated/\n');
      await writeInto(fallbackRoot, 'src/a.ts');
      await writeInto(fallbackRoot, 'generated/bundle.ts');
      await writeInto(fallbackRoot, 'node_modules/pkg/skip.ts');
      const files = await walkRepoFiles({ repoRoot: fallbackRoot, extensions: ['.ts'] });
      expect(files).toEqual(['generated/bundle.ts', 'src/a.ts']);
    } finally {
      await rm(fallbackRoot, { recursive: true, force: true });
    }
  });
});

// GITIGNORED PATHS ARE NOT DOCUMENTATION SOURCE: build output must never be walked as source, and
// (because unversioned reads mark a run uncommitted) must never be able to strip the complete badge.
describe('walkRepoFiles in a git repository', () => {
  let gitRoot = '';

  beforeAll(async () => {
    gitRoot = await mkdtemp(join(tmpdir(), 'docstube-walk-git-'));
    await writeInto(gitRoot, '.gitignore', 'dist/\ngenerated/\napp/assets/\n');
    await writeInto(gitRoot, 'src/a.ts');
    await writeInto(gitRoot, 'src/new.ts');
    await writeInto(gitRoot, 'dist/bundle.js');
    await writeInto(gitRoot, 'generated/bundle.ts');
    await writeInto(gitRoot, 'app/assets/x.js');
    await writeInto(gitRoot, 'app/main.ts');
    await execFileAsync('git', ['init', '-q'], { cwd: gitRoot });
    // Staged == `--cached`: enough to make these tracked without depending on a commit identity.
    await execFileAsync('git', ['add', '.gitignore', 'src/a.ts', 'app/main.ts'], { cwd: gitRoot });
  });

  afterAll(async () => {
    await rm(gitRoot, { recursive: true, force: true });
  });

  it('excludes gitignored build output, including nested output at depth', async () => {
    const files = await walkRepoFiles({ repoRoot: gitRoot });
    expect(files).not.toContain('dist/bundle.js');
    expect(files).not.toContain('generated/bundle.ts');
    expect(files).not.toContain('app/assets/x.js');
  });

  it('keeps tracked sources and untracked-but-not-ignored sources', async () => {
    const files = await walkRepoFiles({ repoRoot: gitRoot, extensions: ['.ts'] });
    // src/new.ts is untracked yet unignored — real source the author has not added yet, which the
    // unversioned-sources rule in @docstube/core still marks the run for.
    expect(files).toEqual(['app/main.ts', 'src/a.ts', 'src/new.ts']);
  });

  // The dogfood build points the codemap at `dist-dogfood/workspace`, a directory the OUTER repo
  // ignores wholesale. Honouring git's (correct) "nothing here is versioned" answer would document
  // nothing at all, so an empty result falls back instead of silently emptying the walk.
  it('falls back rather than going empty when the walk root is itself ignored by an outer repo', async () => {
    const files = await walkRepoFiles({ repoRoot: join(gitRoot, 'generated'), extensions: ['.ts'] });
    expect(files).toEqual(['bundle.ts']);
  });

  it('still honours the explicit ignore option inside a git repository', async () => {
    expect(await walkRepoFiles({ repoRoot: gitRoot, extensions: ['.ts'], ignore: ['app', 'src/new.ts'] })).toEqual([
      'src/a.ts'
    ]);
  });
});
