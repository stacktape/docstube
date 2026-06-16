import { describe, expect, it } from 'vitest';
import {
  configFamilyJsonSchemas,
  docstubeConfigJsonSchema,
  glossaryJsonSchema,
  iaJsonSchema
} from './config-json-schema.ts';

describe('config family JSON Schema', () => {
  it('targets draft 2020-12', () => {
    const schema = docstubeConfigJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('marks default-bearing config fields as optional in the input shape', () => {
    const schema = docstubeConfigJsonSchema();
    const required = schema.required as string[] | undefined;

    expect(required).toContain('site');
    expect(required).toContain('docsType');
    expect(required).toContain('personas');
    expect(required).toContain('agents');
    // version/output/ia/glossary carry defaults, so they are optional on disk.
    expect(required).not.toContain('output');
    expect(required).not.toContain('version');
  });

  it('rejects unknown top-level keys via additionalProperties', () => {
    const schema = docstubeConfigJsonSchema();
    expect(schema.additionalProperties).toBe(false);
  });

  it('snapshots the full config family schema set', () => {
    expect(configFamilyJsonSchemas()).toMatchSnapshot();
  });

  it('generates ia and glossary schemas', () => {
    expect(iaJsonSchema().type).toBe('object');
    expect(glossaryJsonSchema().type).toBe('object');
  });
});
