import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigValidationError } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { editYamlDocument, loadDocstubeConfig, loadGlossary, loadIa, setYamlIn } from './config-yaml.ts';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const capturedValidationError = (load: () => unknown): ConfigValidationError => {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected ConfigValidationError.');
};

describe('config family loaders', () => {
  it('loads and validates the docstube.yml reference fixture', () => {
    const config = loadDocstubeConfig(fixture('docstube.yml'));

    expect(config.site.name).toBe('Acme Toolkit');
    expect(config.docsType).toBe('library');
    expect(config.output.layout).toBe('single-tree');
    expect(config.personas).toHaveLength(2);
    expect(config.agents.writer.adapter).toBe('codex');
    expect(config.caps?.maxUsd).toBe(5);
    expect(config.screenshots).toEqual({ enabled: false });
  });

  it('loads the ia.yml and glossary.yaml reference fixtures', () => {
    const ia = loadIa(fixture('ia.yml'));
    const glossary = loadGlossary(fixture('glossary.yaml'));

    expect(ia.nav).toHaveLength(2);
    expect(ia.nav[1]?.children?.[0]?.path).toBe('guides/install.mdx');
    expect(glossary.terms.map((term) => term.id)).toEqual(['codemap', 'persona']);
  });

  it('rejects an invalid config with a structured ConfigValidationError', () => {
    const error = capturedValidationError(() => loadDocstubeConfig(fixture('docstube.invalid.yml')));

    expect(error.file).toBe('docstube.yml');
    expect(error.issues.length).toBeGreaterThan(0);
  });
});

describe('comment-preserving YAML edits', () => {
  it('edits a value while retaining comments and formatting', () => {
    const source = fixture('docstube.yml');
    const edited = setYamlIn(source, ['site', 'name'], 'Renamed Toolkit');

    // The value changed.
    expect(edited).toContain('name: Renamed Toolkit');
    expect(loadDocstubeConfig(edited).site.name).toBe('Renamed Toolkit');

    // Comments and surrounding structure survived the edit.
    expect(edited).toContain('# docstube configuration. Edited by the setup wizard with comments preserved.');
    expect(edited).toContain('# shown in the site header');
    expect(edited).toContain('# codex | claude | gemini | api');
    expect(edited).toContain('# Reserved for a future screenshots capability. Not used yet.');
  });

  it('adds a new value through the Document API without dropping comments', () => {
    const source = fixture('docstube.yml');
    const edited = editYamlDocument(source, (doc) => {
      doc.setIn(['caps', 'maxTokens'], 2_000_000);
    });

    expect(edited).toContain('# Approximate usage caps. docstube freezes with margin near these.');
    const config = loadDocstubeConfig(edited);
    expect(config.caps?.maxTokens).toBe(2_000_000);
    expect(config.caps?.maxUsd).toBe(5);
  });
});
