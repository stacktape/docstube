import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema } from './config-schema.ts';
import { docstubeConfigJsonSchema } from './config-json-schema.ts';
import { fixtureConfigInput } from './fixtures.ts';

const configWithImportKind = (kind: string) => ({
  ...fixtureConfigInput,
  sources: { imports: [{ kind, location: 'https://example.readme.io' }] }
});

const parseLocales = (locales: unknown) => docstubeConfigSchema.safeParse({ ...fixtureConfigInput, locales });

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

  it('applies nested field defaults through an omitted parent block (single-source defaults)', () => {
    const config = docstubeConfigSchema.parse({
      schemaVersion: 1,
      docType: 'external-library',
      personas: [{ id: 'app-developer', description: 'Builds apps on top of the library' }],
      site: { title: 'x' }
    });
    expect(config.agents.budgets).toEqual({
      maxRunUsd: 20,
      maxTurnsPerTask: 24,
      maxToolCallsPerTask: 64,
      maxPlanUsagePercent: 80
    });
    expect(config.agents.transport).toBe('claude-cli');
    expect(config.sources).toEqual({ openapi: [], asyncapi: [], imports: [] });
    expect(config.telemetry).toEqual({ enabled: true });
  });

  it('keeps maxRunUsd overridable while defaulting it to 20', () => {
    const config = docstubeConfigSchema.parse({ ...fixtureConfigInput, agents: { budgets: { maxRunUsd: 5 } } });
    expect(config.agents.budgets.maxRunUsd).toBe(5);
    expect(config.agents.budgets.maxTurnsPerTask).toBe(24);
  });

  it('accepts an optional agents.reviewModel', () => {
    const config = docstubeConfigSchema.parse({ ...fixtureConfigInput, agents: { reviewModel: 'claude-haiku-5' } });
    expect(config.agents.reviewModel).toBe('claude-haiku-5');
    expect(docstubeConfigSchema.parse(fixtureConfigInput).agents.reviewModel).toBeUndefined();
  });

  it('exposes only the four public transports — google and replay are internal-only', () => {
    for (const transport of ['claude-cli', 'codex-cli', 'anthropic-api', 'openai-compatible']) {
      expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, agents: { transport } }).success).toBe(true);
    }
    for (const transport of ['google', 'replay']) {
      expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, agents: { transport } }).success).toBe(false);
    }
  });

  it("imports use 'readme-com' (ReadMe.com), never a bare 'readme'", () => {
    expect(docstubeConfigSchema.safeParse(configWithImportKind('readme-com')).success).toBe(true);
    expect(docstubeConfigSchema.safeParse(configWithImportKind('readme')).success).toBe(false);
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

  it('hard-errors on unknown keys at the root and in hand-edited nested blocks', () => {
    expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, projektContext: 'typo' }).success).toBe(false);
    expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, agents: { transprot: 'claude-cli' } }).success).toBe(
      false
    );
    expect(
      docstubeConfigSchema.safeParse({ ...fixtureConfigInput, agents: { budgets: { maxRunUSD: 5 } } }).success
    ).toBe(false);
    expect(
      docstubeConfigSchema.safeParse({ ...fixtureConfigInput, site: { title: 'x', favicom: 'a.png' } }).success
    ).toBe(false);
  });

  it("defaults theme.name to 'basic' and keeps it overridable next to tokens", () => {
    const config = docstubeConfigSchema.parse(fixtureConfigInput);
    expect(config.theme).toEqual({ name: 'basic', tokens: {} });
    const themed = docstubeConfigSchema.parse({
      ...fixtureConfigInput,
      theme: { name: 'stacktape', tokens: { accent: '#36bebe', fontBody: 'Inter' } }
    });
    expect(themed.theme.name).toBe('stacktape');
    expect(themed.theme.tokens).toEqual({ accent: '#36bebe', fontBody: 'Inter' });
    // Still strict: unknown theme keys are a hard error.
    expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, theme: { nmae: 'basic' } }).success).toBe(false);
  });

  it('REJECTS the deleted reserved stubs: autonomy and screenshots are fake affordances (impl-07 finding 8)', () => {
    // Validated-but-unenforced keys misrepresent capability; strict parsing now hard-errors on
    // them like any other unknown key. The v2 policy engine / screenshot capture will add their
    // config together with their implementations.
    expect(
      docstubeConfigSchema.safeParse({
        ...fixtureConfigInput,
        autonomy: { rules: [{ glob: 'docs/internals/**', mode: 'review' }] }
      }).success
    ).toBe(false);
    expect(docstubeConfigSchema.safeParse({ ...fixtureConfigInput, screenshots: {} }).success).toBe(false);
  });

  // TRANSLATION TARGETS (wave 2b close 2 finding): the source locale is truth, so it is never a
  // target, and a repeated target buys a second identical rendition of the same route.
  describe('locales.targets', () => {
    it('accepts distinct targets that are not the source locale', () => {
      const result = parseLocales({ source: 'en', targets: ['de', 'pt-BR', 'zh-Hans'] });
      expect(result.success).toBe(true);
      expect(result.data?.locales.targets).toEqual(['de', 'pt-BR', 'zh-Hans']);
    });

    it('rejects the source locale appearing among the targets, naming it', () => {
      const result = parseLocales({ source: 'de', targets: ['en', 'de'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('"de"');
      expect(result.error?.issues[0]?.message).toContain('source locale');
      expect(result.error?.issues[0]?.path).toEqual(['locales', 'targets', 1]);
    });

    it('rejects a duplicate target, naming the repeat', () => {
      const result = parseLocales({ source: 'en', targets: ['pt-BR', 'de', 'pt-BR'] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('"pt-BR"');
      expect(result.error?.issues[0]?.message).toContain('more than once');
      expect(result.error?.issues[0]?.path).toEqual(['locales', 'targets', 2]);
    });

    // The locale grammar already pins each subtag's case, so a differently-cased spelling of the
    // same locale never reaches the comparison — it is rejected as a malformed code. The
    // comparison stays case-insensitive anyway, matching localeRoutePrefixConflict: the two rules
    // decide the same thing (which /<locale>/ directory a target owns) and must not disagree.
    it('rejects a differently-cased spelling of a configured locale', () => {
      expect(parseLocales({ source: 'pt-BR', targets: ['pt-br'] }).success).toBe(false);
      expect(parseLocales({ source: 'en', targets: ['pt-BR', 'pt-br'] }).success).toBe(false);
    });
  });
});

describe('generated JSON schema', () => {
  it('emits a schema with a stable $id for SchemaStore registration', () => {
    const jsonSchema = docstubeConfigJsonSchema();
    expect(jsonSchema.$id).toBe('https://docstube.dev/schemas/docstube.yml.json');
    expect(jsonSchema).toHaveProperty('properties');
  });
});
