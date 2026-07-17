import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseForeignDocs } from './parse-foreign-docs.ts';

// One unreadable file must become a skipped entry, never abort the whole audit walk.

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFile = async (path: unknown, ...rest: unknown[]) => {
    if (typeof path === 'string' && path.includes('unreadable.md')) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    }
    return actual.readFile(path as never, ...(rest as never[]));
  };
  return { ...actual, readFile };
});

let docsDir: string;

beforeEach(async () => {
  docsDir = await mkdtemp(join(tmpdir(), 'docstube-foreign-'));
  await writeFile(join(docsDir, 'readable.md'), '# Readable\n');
  await writeFile(join(docsDir, 'unreadable.md'), '# Never returned\n');
});

afterEach(async () => {
  await rm(docsDir, { recursive: true, force: true });
});

describe('parseForeignDocs', () => {
  it('reports an unreadable file as skipped and keeps parsing the rest', async () => {
    const result = await parseForeignDocs({ docsDir });
    expect(result.pages.map((page) => page.file)).toEqual(['readable.md']);
    expect(result.skipped).toEqual([{ file: 'unreadable.md', reason: expect.stringContaining('EACCES') }]);
  });
});
