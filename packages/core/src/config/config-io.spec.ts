import { describe, expect, it } from 'vitest';
import { CoreError } from '../errors.ts';
import { parseDocstubeConfig, setYamlIn } from './config-io.ts';

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
