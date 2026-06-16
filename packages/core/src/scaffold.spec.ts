import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestSchema } from '@docstube/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { scaffoldDocstubeDir } from './scaffold.ts';

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe('scaffoldDocstubeDir', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docstube-scaffold-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates the committed manifest, criteria, and instructions scaffold', async () => {
    const result = await scaffoldDocstubeDir(root);

    const manifestPath = join(root, '.docstube', 'manifest.yml');
    expect(await pathExists(manifestPath)).toBe(true);
    expect(await pathExists(join(root, '.docstube', 'criteria', '.gitkeep'))).toBe(true);
    expect(await pathExists(join(root, '.docstube', 'instructions', '.gitkeep'))).toBe(true);
    expect(result.created).toContain(manifestPath);

    const manifest = manifestSchema.parse(parse(await readFile(manifestPath, 'utf8')));
    expect(manifest.version).toBe(1);
    expect(manifest.generatedWith.name).toBe('docstube');
    expect(manifest.pages).toEqual([]);
  });

  it('never writes machine-local state, secrets, or transcripts', async () => {
    await scaffoldDocstubeDir(root);

    const docstubeDir = join(root, '.docstube');
    expect(await pathExists(join(docstubeDir, 'db.sqlite'))).toBe(false);
    expect(await pathExists(join(docstubeDir, 'cache'))).toBe(false);
    expect(await pathExists(join(docstubeDir, 'runs'))).toBe(false);
    expect(await pathExists(join(docstubeDir, '.env'))).toBe(false);
  });

  it('is non-destructive: an existing manifest is preserved unless forced', async () => {
    await scaffoldDocstubeDir(root);
    const second = await scaffoldDocstubeDir(root);

    const manifestPath = join(root, '.docstube', 'manifest.yml');
    expect(second.created).not.toContain(manifestPath);
    expect(second.skipped).toContain(manifestPath);

    const forced = await scaffoldDocstubeDir(root, { force: true });
    expect(forced.created).toContain(manifestPath);
  });
});
