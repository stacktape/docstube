import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentHash } from '@docstube/contracts';
import { ToolPolicyError } from './errors.ts';
import { createObservedReadsCollector, createStandardTools, standardToolDescriptors } from './tools.ts';
import type { ToolImplementation } from './tools.ts';

const RETRY_TS = 'export const retries = 3;\nexport const jitter = true;\n';
const UTIL_TS = 'export const clamp = (n: number) => Math.max(0, n);\n';

let repoRoot: string;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-tools-'));
  await mkdir(join(repoRoot, 'src', 'nested'), { recursive: true });
  await mkdir(join(repoRoot, 'secrets'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), RETRY_TS, 'utf8');
  await writeFile(join(repoRoot, 'src', 'nested', 'util.ts'), UTIL_TS, 'utf8');
  await writeFile(join(repoRoot, 'README.md'), '# Fixture\n', 'utf8');
  await writeFile(join(repoRoot, 'secrets', 'token.txt'), 'not-a-real-secret\n', 'utf8');
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const buildTools = (readRoots: string[] = ['.']) => {
  const observedReads = createObservedReadsCollector();
  const tools = createStandardTools({ repoRoot, readRoots, observedReads });
  const byName = new Map(tools.map((tool) => [tool.descriptor.name, tool]));
  const get = (name: string): ToolImplementation => {
    const tool = byName.get(name);
    if (!tool) {
      throw new Error(`missing tool ${name}`);
    }
    return tool;
  };
  return { observedReads, get };
};

describe('read_file', () => {
  it('returns content and records an observed read with the full-file content hash', async () => {
    const { observedReads, get } = buildTools();
    const result = (await get('read_file').handler({ path: 'src/retry.ts' })) as { content: string; path: string };
    expect(result.path).toBe('src/retry.ts');
    expect(result.content).toContain('retries = 3');
    expect(observedReads.list()).toEqual([{ file: 'src/retry.ts', contentHash: contentHash(RETRY_TS) }]);
  });

  it('slices an inclusive 1-based line range but still hashes the whole file', async () => {
    const { observedReads, get } = buildTools();
    const result = (await get('read_file').handler({ path: 'src/retry.ts', startLine: 2, endLine: 2 })) as {
      content: string;
      startLine: number;
      endLine: number;
      totalLines: number;
    };
    expect(result.content).toBe('export const jitter = true;');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(2);
    expect(observedReads.list()[0]?.contentHash).toBe(contentHash(RETRY_TS));
  });

  it('deduplicates repeated reads of identical content', async () => {
    const { observedReads, get } = buildTools();
    await get('read_file').handler({ path: 'src/retry.ts' });
    await get('read_file').handler({ path: 'src/retry.ts', startLine: 1, endLine: 1 });
    expect(observedReads.list()).toHaveLength(1);
  });

  it('rejects ".." traversal out of the repo root', async () => {
    const { get } = buildTools();
    await expect(get('read_file').handler({ path: '../outside.txt' })).rejects.toThrow(ToolPolicyError);
  });

  it('rejects absolute and backslash paths', async () => {
    const { get } = buildTools();
    await expect(get('read_file').handler({ path: join(repoRoot, 'README.md') })).rejects.toThrow(ToolPolicyError);
    await expect(get('read_file').handler({ path: 'src\\retry.ts' })).rejects.toThrow(ToolPolicyError);
  });

  it('rejects paths outside the declared read roots, including via ".." from inside a root', async () => {
    const { get } = buildTools(['src']);
    await expect(get('read_file').handler({ path: 'secrets/token.txt' })).rejects.toThrow(ToolPolicyError);
    await expect(get('read_file').handler({ path: 'src/../secrets/token.txt' })).rejects.toThrow(ToolPolicyError);
  });

  it('rejects invalid arguments', async () => {
    const { get } = buildTools();
    await expect(get('read_file').handler({})).rejects.toThrow(ToolPolicyError);
  });

  it('returns a bounded prefix for oversized files without recording an observed read', async () => {
    const { observedReads, get } = buildTools();
    // Just over the 1MB stat cap; the file is never fully loaded.
    await writeFile(join(repoRoot, 'src', 'huge.txt'), `first line\n${'x'.repeat(1_100_000)}`, 'utf8');
    try {
      const result = (await get('read_file').handler({ path: 'src/huge.txt' })) as {
        content: string;
        truncated: boolean;
        note?: string;
      };
      expect(result.truncated).toBe(true);
      expect(result.note).toContain('file too large');
      expect(result.content.startsWith('first line')).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(1_000_000);
      // A prefix hash would never match the full-file hash staleness checks compare against.
      expect(observedReads.list()).toEqual([]);
    } finally {
      await rm(join(repoRoot, 'src', 'huge.txt'), { force: true });
    }
  });

  it('rejects a symlink inside a read root that points outside every root', async () => {
    // Windows needs a privilege (or Developer Mode) to create symlinks; skip gracefully there.
    let created = false;
    try {
      await symlink(join(repoRoot, 'secrets', 'token.txt'), join(repoRoot, 'src', 'sneaky.txt'), 'file');
      created = true;
    } catch {
      return;
    }
    try {
      const { get } = buildTools(['src']);
      await expect(get('read_file').handler({ path: 'src/sneaky.txt' })).rejects.toThrow(/symlink escape/);
      // The same link is fine when the read roots cover its target.
      const wide = buildTools(['.']);
      const result = (await wide.get('read_file').handler({ path: 'src/sneaky.txt' })) as { content: string };
      expect(result.content).toContain('not-a-real-secret');
    } finally {
      if (created) {
        await rm(join(repoRoot, 'src', 'sneaky.txt'), { force: true });
      }
    }
  });
});

describe('list_dir', () => {
  it('lists entries with their types', async () => {
    const { get } = buildTools();
    const result = (await get('list_dir').handler({ path: 'src' })) as { entries: { name: string; type: string }[] };
    expect(result.entries).toEqual([
      { name: 'nested', type: 'dir' },
      { name: 'retry.ts', type: 'file' }
    ]);
  });
});

describe('glob', () => {
  it('matches files recursively and returns sorted repo-relative POSIX paths', async () => {
    const { get } = buildTools();
    const result = (await get('glob').handler({ pattern: '**/*.ts' })) as { matches: string[]; truncated: boolean };
    expect(result.matches).toEqual(['src/nested/util.ts', 'src/retry.ts']);
    expect(result.truncated).toBe(false);
  });

  it('scopes matches to the given directory', async () => {
    const { get } = buildTools();
    const result = (await get('glob').handler({ pattern: '*.ts', path: 'src/nested' })) as { matches: string[] };
    expect(result.matches).toEqual(['src/nested/util.ts']);
  });

  it('rejects patterns with ".." segments', async () => {
    const { get } = buildTools(['src']);
    await expect(get('glob').handler({ pattern: '../secrets/*', path: 'src' })).rejects.toThrow(ToolPolicyError);
  });
});

describe('grep', () => {
  it('returns matching lines with file and line number', async () => {
    const { get } = buildTools();
    const result = (await get('grep').handler({ pattern: 'jitter', path: 'src' })) as {
      matches: { file: string; line: number; text: string }[];
    };
    expect(result.matches).toEqual([{ file: 'src/retry.ts', line: 2, text: 'export const jitter = true;' }]);
  });

  it('bounds the number of matches', async () => {
    const { get } = buildTools();
    const result = (await get('grep').handler({ pattern: 'export', maxMatches: 1 })) as {
      matches: unknown[];
      truncated: boolean;
    };
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('rejects invalid regular expressions', async () => {
    const { get } = buildTools();
    await expect(get('grep').handler({ pattern: '(' })).rejects.toThrow(ToolPolicyError);
  });

  it('does not search outside its read roots', async () => {
    const { get } = buildTools(['src']);
    await expect(get('grep').handler({ pattern: 'secret', path: 'secrets' })).rejects.toThrow(ToolPolicyError);
  });
});

describe('standardToolDescriptors', () => {
  it('exposes the four standard tools with JSON param schemas', () => {
    const descriptors = standardToolDescriptors();
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual(['read_file', 'list_dir', 'glob', 'grep']);
    for (const descriptor of descriptors) {
      expect(descriptor.paramsJsonSchema.type).toBe('object');
    }
  });
});
