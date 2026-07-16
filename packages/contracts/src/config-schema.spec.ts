import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema } from './config-schema.ts';
import { docstubeConfigJsonSchema } from './config-json-schema.ts';
import { fixtureConfigInput } from './fixtures.ts';

describe('docstube.yml schema', () => {
  it('parses a minimal config and applies defaults', () => {
    const config = docstubeConfigSchema.parse(fixtureConfigInput);
    expect(config.agents.transport).toBe('claude-cli');
    expect(config.locales).toEqual({ source: 'en', targets: [] });
    expect(config.versions.current).toBe('latest');
    expect(config.site.layout).toBe('single-tree');
    expect(config.site.footerCredit).toBe(true);
    expect(config.outDir).toBe('docs-site');
    expect(config.coverage).toBe('auto');
  });

  it('requires at least one persona', () => {
    const result = docstubeConfigSchema.safeParse({ ...fixtureConfigInput, personas: [] });
    expect(result.success).toBe(false);
  });

  it('only accepts env-var NAMES for credentials, never values', () => {
    const withEnvName = { ...fixtureConfigInput, agents: { apiKeyEnv: 'MY_PROVIDER_KEY' } };
    expect(docstubeConfigSchema.safeParse(withEnvName).success).toBe(true);
    const withValue = { ...fixtureConfigInput, agents: { apiKeyEnv: 'sk-ant-abc123' } };
    expect(docstubeConfigSchema.safeParse(withValue).success).toBe(false);
  });

  it('accepts the reserved autonomy block without requiring it', () => {
    const config = docstubeConfigSchema.parse({
      ...fixtureConfigInput,
      autonomy: { rules: [{ glob: 'docs/internals/**', mode: 'review' }] }
    });
    expect(config.autonomy?.default.mode).toBe('auto-merge');
  });
});

describe('generated JSON schema', () => {
  it('emits a schema with a stable $id for SchemaStore registration', () => {
    const jsonSchema = docstubeConfigJsonSchema();
    expect(jsonSchema.$id).toBe('https://docstube.dev/schemas/docstube.yml.json');
    expect(jsonSchema).toHaveProperty('properties');
  });
});
