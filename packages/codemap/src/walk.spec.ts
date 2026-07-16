import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walkRepoFiles } from './walk.ts';

// The walk skips node_modules/dist/etc., so this fixture tree cannot live committed in the repo
// (node_modules is git-ignored). Built in a temp dir instead.
let repoRoot = '';

const writeFixture = async (relativePath: string): Promise<void> => {
  const absolute = join(repoRoot, ...relativePath.split('/'));
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, `// ${relativePath}\n`, 'utf8');
};

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
});
