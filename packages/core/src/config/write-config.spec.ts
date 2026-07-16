import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ia } from '@docstube/contracts';
import { fixtureConfigInput } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { loadConfigFamily, parseDocstubeConfig, parseIaFile } from './config-io.ts';
import { scaffoldConfigFamily, updateConfigValues, writeIaFile } from './write-config.ts';

const makeRepoRoot = () => mkdtemp(join(tmpdir(), 'docstube-write-config-'));

const annotatedConfig = [
  '# hand annotation — must survive every programmatic write',
  'schemaVersion: 1',
  'docType: external-library',
  'projectContext: A fixture library # trailing note',
  'personas:',
  '  - id: app-developer',
  '    description: Builds apps on top of the library',
  'site:',
  '  title: Fixture Docs',
  ''
].join('\n');

const fixtureIa: Ia = {
  schemaVersion: 1,
  tree: [{ title: 'Getting started', slug: 'getting-started', brief: 'Install and run.', depth: 'standard' }]
};

describe('updateConfigValues', () => {
  it('applies batched edits while preserving comments', async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(join(repoRoot, 'docstube.yml'), annotatedConfig, 'utf8');

    const updated = await updateConfigValues(repoRoot, [
      { path: ['site', 'title'], value: 'Renamed Docs' },
      { path: ['site', 'description'], value: 'Now with a description' }
    ]);
    expect(updated.site.title).toBe('Renamed Docs');
    expect(updated.site.description).toBe('Now with a description');

    const text = await readFile(join(repoRoot, 'docstube.yml'), 'utf8');
    expect(text).toContain('# hand annotation — must survive every programmatic write');
    expect(text).toContain('# trailing note');
    expect(parseDocstubeConfig(text).site.title).toBe('Renamed Docs');
  });

  it('rejects atomically when the result would be invalid', async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(join(repoRoot, 'docstube.yml'), annotatedConfig, 'utf8');

    await expect(updateConfigValues(repoRoot, [{ path: ['docType'], value: 'not-a-doc-type' }])).rejects.toMatchObject({
      code: 'config-invalid'
    });
    const text = await readFile(join(repoRoot, 'docstube.yml'), 'utf8');
    expect(text).toBe(annotatedConfig);
  });

  it('reports a missing config with the config-missing code', async () => {
    const repoRoot = await makeRepoRoot();
    await expect(updateConfigValues(repoRoot, [{ path: ['site', 'title'], value: 'x' }])).rejects.toMatchObject({
      code: 'config-missing'
    });
  });
});

describe('writeIaFile', () => {
  it('creates ia.yml from the parsed structure', async () => {
    const repoRoot = await makeRepoRoot();
    await writeIaFile(repoRoot, fixtureIa);
    const parsed = parseIaFile(await readFile(join(repoRoot, 'ia.yml'), 'utf8'));
    expect(parsed.tree[0]?.slug).toBe('getting-started');
  });

  it('replaces the tree but keeps the document header comment', async () => {
    const repoRoot = await makeRepoRoot();
    await writeFile(
      join(repoRoot, 'ia.yml'),
      '# my ia notes — keep me\nschemaVersion: 1\ntree:\n  - title: Old\n    slug: old\n',
      'utf8'
    );
    await writeIaFile(repoRoot, fixtureIa);
    const text = await readFile(join(repoRoot, 'ia.yml'), 'utf8');
    expect(text).toContain('# my ia notes — keep me');
    const parsed = parseIaFile(text);
    expect(parsed.tree).toHaveLength(1);
    expect(parsed.tree[0]?.title).toBe('Getting started');
  });

  it('refuses to write an invalid ia', async () => {
    const repoRoot = await makeRepoRoot();
    const invalid = { schemaVersion: 1, tree: [{ title: 'Bad', slug: 'Not A Slug' }] } as unknown as Ia;
    await expect(writeIaFile(repoRoot, invalid)).rejects.toThrow(CoreError);
  });
});

describe('scaffoldConfigFamily', () => {
  it('creates docstube.yml and ia.yml with a friendly header', async () => {
    const repoRoot = await makeRepoRoot();
    const result = await scaffoldConfigFamily(repoRoot, { config: fixtureConfigInput, ia: fixtureIa });
    expect(result.configPath).toBe(join(repoRoot, 'docstube.yml'));

    const configText = await readFile(result.configPath, 'utf8');
    expect(configText.startsWith('# docstube.yml —')).toBe(true);
    const iaText = await readFile(result.iaPath, 'utf8');
    expect(iaText.startsWith('# ia.yml —')).toBe(true);

    const family = await loadConfigFamily(repoRoot);
    expect(family.config.docType).toBe('external-library');
    expect(family.ia.tree[0]?.slug).toBe('getting-started');
  });

  it('refuses to overwrite existing files', async () => {
    const repoRoot = await makeRepoRoot();
    await scaffoldConfigFamily(repoRoot, { config: fixtureConfigInput, ia: fixtureIa });
    await expect(scaffoldConfigFamily(repoRoot, { config: fixtureConfigInput, ia: fixtureIa })).rejects.toThrow(
      /refusing to overwrite/
    );
  });

  it('validates the seed before touching disk', async () => {
    const repoRoot = await makeRepoRoot();
    const invalidConfig = { ...fixtureConfigInput, personas: [] };
    await expect(scaffoldConfigFamily(repoRoot, { config: invalidConfig, ia: fixtureIa })).rejects.toMatchObject({
      code: 'config-invalid'
    });
    await expect(loadConfigFamily(repoRoot)).rejects.toMatchObject({ code: 'config-missing' });
  });
});
