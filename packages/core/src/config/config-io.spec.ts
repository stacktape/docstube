import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoreError } from '../errors.ts';
import { editConfigFile, loadConfigFamily, parseDocstubeConfig, setYamlIn } from './config-io.ts';

const configYaml = `# docstube configuration — hand-tuned, do not lose this comment
schemaVersion: 1
docType: external-library
personas:
  # our primary audience
  - id: app-developer
    description: Builds apps on top of the library
site:
  title: Fixture Docs
`;

describe('config parsing', () => {
  it('parses valid config', () => {
    const config = parseDocstubeConfig(configYaml);
    expect(config.docType).toBe('external-library');
    expect(config.personas[0]?.id).toBe('app-developer');
  });

  it('reports schema violations with paths as CoreError', () => {
    const attempt = () => parseDocstubeConfig(configYaml.replace('external-library', 'blog'));
    expect(attempt).toThrow(CoreError);
    expect(attempt).toThrow(/docType/u);
  });
});

describe('comment-preserving edits', () => {
  it('preserves comments and formatting when setting values', () => {
    const updated = setYamlIn(configYaml, ['site', 'title'], 'Renamed Docs');
    expect(updated).toContain('# docstube configuration — hand-tuned, do not lose this comment');
    expect(updated).toContain('# our primary audience');
    expect(updated).toContain('Renamed Docs');
    // Still valid config after the edit.
    expect(parseDocstubeConfig(updated).site.title).toBe('Renamed Docs');
  });
});

// LOCALE-PREFIX SLUG COLLISION (impl-24 finding): a page slug that occupies a configured locale's
// route namespace makes the emitted route nondeterministic — /de/foo is both "the German rendition
// of foo" and "the page slugged de/foo". It is an authoring error with two valid fixes, so it is
// rejected by name at the earliest point both files are in hand, never guessed at.
describe('locale-prefix slug validation at IA load', () => {
  const writeFamily = async (targets: string[], slug: string): Promise<string> => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-locale-slug-'));
    await writeFile(
      join(repoRoot, 'docstube.yml'),
      `${configYaml}locales:\n  source: en\n  targets: [${targets.join(', ')}]\n`,
      'utf8'
    );
    await writeFile(
      join(repoRoot, 'ia.yml'),
      `schemaVersion: 1\ntree:\n  - title: Foo\n    slug: ${slug}\n    brief: A page.\n`,
      'utf8'
    );
    return repoRoot;
  };

  it('rejects a page slug that is a configured target locale, naming the page, slug and locale', async () => {
    const repoRoot = await writeFamily(['de'], 'de');
    await expect(loadConfigFamily(repoRoot)).rejects.toMatchObject({ code: 'config-invalid' });
    await expect(loadConfigFamily(repoRoot)).rejects.toThrow(/page "Foo" has slug "de".*"de" locale route/su);
  });

  it('accepts the same slug when that locale is not configured — the collision needs both halves', async () => {
    const repoRoot = await writeFamily(['fr'], 'de');
    const family = await loadConfigFamily(repoRoot);
    expect(family.ia.tree[0]?.slug).toBe('de');
  });

  it('ignores grouping nodes: a node with no brief and no pageId renders no page and claims no route', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-locale-slug-'));
    await writeFile(join(repoRoot, 'docstube.yml'), `${configYaml}locales:\n  source: en\n  targets: [de]\n`, 'utf8');
    await writeFile(
      join(repoRoot, 'ia.yml'),
      'schemaVersion: 1\ntree:\n  - title: Group\n    slug: de\n    children:\n      - title: Foo\n        slug: foo\n        brief: A page.\n',
      'utf8'
    );
    await expect(loadConfigFamily(repoRoot)).resolves.toBeDefined();
  });
});

describe('editConfigFile', () => {
  it('validates the edited document against the owning schema and writes nothing on failure', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'docstube-editcfg-'));
    await writeFile(join(repoRoot, 'docstube.yml'), configYaml, 'utf8');

    await expect(
      editConfigFile(repoRoot, 'docstube.yml', (doc) => {
        doc.setIn(['docType'], 'blog');
      })
    ).rejects.toMatchObject({ code: 'config-invalid' });
    expect(await readFile(join(repoRoot, 'docstube.yml'), 'utf8')).toBe(configYaml);

    await editConfigFile(repoRoot, 'docstube.yml', (doc) => {
      doc.setIn(['site', 'title'], 'Edited Docs');
    });
    const edited = await readFile(join(repoRoot, 'docstube.yml'), 'utf8');
    expect(edited).toContain('# docstube configuration — hand-tuned, do not lose this comment');
    expect(parseDocstubeConfig(edited).site.title).toBe('Edited Docs');
  });
});
