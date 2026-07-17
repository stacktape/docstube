import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoreError } from '../errors.ts';
import { editConfigFile, parseDocstubeConfig, setYamlIn } from './config-io.ts';

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
