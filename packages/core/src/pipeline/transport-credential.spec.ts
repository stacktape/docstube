import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema, fixtureConfigInput } from '@docstube/contracts';
import {
  credentialEnvVarPresent,
  isPrivateEndpoint,
  resolveRunCredentialRequirements,
  resolveTransportCredentialRequirement
} from './transport-credential.ts';

// What the CI preflight asks before spending anything: which credential will the run ACTUALLY
// read? The answer must track createTransportFromConfig exactly — same transport id, same model
// fallback, same apiKeyEnv/baseUrl defaults.

const config = (agents: Record<string, unknown>) => docstubeConfigSchema.parse({ ...fixtureConfigInput, agents });

describe('resolveTransportCredentialRequirement', () => {
  it('names the transport default env var when the config does not override it', () => {
    const requirement = resolveTransportCredentialRequirement(config({ transport: 'anthropic-api' }), {});
    expect(requirement).toMatchObject({
      transportId: 'anthropic-api',
      kind: 'api-key',
      credentialEnvVars: ['ANTHROPIC_API_KEY'],
      model: 'claude-sonnet-5'
    });
  });

  it('honors an apiKeyEnv override — that env var, and only that one, is the credential', () => {
    const requirement = resolveTransportCredentialRequirement(
      config({ transport: 'anthropic-api', apiKeyEnv: 'MY_MODEL_KEY' }),
      {}
    );
    expect(requirement.credentialEnvVars).toEqual(['MY_MODEL_KEY']);
    expect(credentialEnvVarPresent(requirement, { ANTHROPIC_API_KEY: 'set-but-unread' })).toBeUndefined();
    expect(credentialEnvVarPresent(requirement, { MY_MODEL_KEY: 'value' })).toBe('MY_MODEL_KEY');
  });

  it('treats openai-compatible without apiKeyEnv as keyless, and marks a hosted endpoint as public', () => {
    const hosted = resolveTransportCredentialRequirement(
      config({ transport: 'openai-compatible', model: 'gpt-5' }),
      {}
    );
    expect(hosted).toMatchObject({ kind: 'keyless', endpoint: 'https://api.openai.com/v1', endpointIsPrivate: false });

    const local = resolveTransportCredentialRequirement(
      config({ transport: 'openai-compatible', model: 'llama3', baseUrl: 'http://127.0.0.1:11434/v1' }),
      {}
    );
    expect(local).toMatchObject({ kind: 'keyless', endpointIsPrivate: true });
  });

  it('reports vendor CLIs by binary plus the tokens an unattended run can authenticate with', () => {
    expect(resolveTransportCredentialRequirement(config({ transport: 'claude-cli' }), {})).toMatchObject({
      kind: 'vendor-cli',
      binary: 'claude',
      credentialEnvVars: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
    });
    expect(resolveTransportCredentialRequirement(config({ transport: 'codex-cli', model: 'gpt-5' }), {})).toMatchObject(
      { kind: 'vendor-cli', binary: 'codex' }
    );
  });

  it('resolves the transport the run will actually use, including the internal override', () => {
    const requirement = resolveTransportCredentialRequirement(config({ transport: 'anthropic-api' }), {
      DOCSTUBE_TRANSPORT_OVERRIDE: 'replay'
    });
    expect(requirement).toMatchObject({ transportId: 'replay', kind: 'keyless', model: 'replay' });
  });

  it('reports a config that cannot construct a transport at all instead of guessing a model', () => {
    const requirement = resolveTransportCredentialRequirement(config({ transport: 'codex-cli' }), {});
    expect(requirement.model).toBeUndefined();
    expect(requirement.configProblem).toContain('agents.model');
  });
});

// EVERY provider a run could touch. A role routed elsewhere spends real money on a real account,
// so its credential is preflight's business exactly as much as the writer's.
describe('resolveRunCredentialRequirements', () => {
  it('collapses to ONE requirement when every role inherits the run default', () => {
    const requirements = resolveRunCredentialRequirements(config({ transport: 'anthropic-api' }), {});
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.roles).toEqual(['writer', 'reviewer', 'translator', 'architect', 'extractor']);
  });

  it('reports the role-overridden provider as its own requirement, with its own env var', () => {
    const requirements = resolveRunCredentialRequirements(
      config({
        transport: 'anthropic-api',
        apiKeyEnv: 'MY_ANTHROPIC_KEY',
        roles: { reviewer: { transport: 'openai-compatible', model: 'gpt-5-mini' } }
      }),
      {}
    );
    expect(requirements).toHaveLength(2);
    const [primary, reviewer] = requirements;
    expect(primary).toMatchObject({ transportId: 'anthropic-api', credentialEnvVars: ['MY_ANTHROPIC_KEY'] });
    expect(primary?.roles).toEqual(['writer', 'translator', 'architect', 'extractor']);
    // The reviewer switched providers, so the top-level key is NOT forwarded to it.
    expect(reviewer).toMatchObject({ roles: ['reviewer'], transportId: 'openai-compatible', kind: 'keyless' });
    expect(reviewer?.credentialEnvVars).toEqual([]);
  });

  it('surfaces a MISSING credential that only a non-writer role would have needed', () => {
    const requirements = resolveRunCredentialRequirements(
      config({
        transport: 'claude-cli',
        roles: { translator: { transport: 'anthropic-api', model: 'claude-haiku-5' } }
      }),
      {}
    );
    const translator = requirements.find((requirement) => requirement.roles.includes('translator'));
    expect(translator).toMatchObject({ transportId: 'anthropic-api', credentialEnvVars: ['ANTHROPIC_API_KEY'] });
    expect(credentialEnvVarPresent(translator!, { CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })).toBeUndefined();
    expect(credentialEnvVarPresent(translator!, { ANTHROPIC_API_KEY: 'sk-ant' })).toBe('ANTHROPIC_API_KEY');
  });

  it('collapses roles that resolve to the same provider AND model into one requirement', () => {
    const requirements = resolveRunCredentialRequirements(
      config({
        transport: 'anthropic-api',
        model: 'claude-sonnet-5',
        roles: { reviewer: { model: 'claude-haiku-5' }, translator: { model: 'claude-haiku-5' } }
      }),
      {}
    );
    expect(requirements).toHaveLength(2);
    expect(requirements[1]?.roles).toEqual(['reviewer', 'translator']);
    expect(requirements[1]?.model).toBe('claude-haiku-5');
  });
});

describe('isPrivateEndpoint', () => {
  it('recognizes loopback, private ranges, and bare hostnames as local', () => {
    expect(isPrivateEndpoint('http://localhost:11434/v1')).toBe(true);
    expect(isPrivateEndpoint('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isPrivateEndpoint('http://192.168.1.10:8080/v1')).toBe(true);
    expect(isPrivateEndpoint('http://ollama:11434/v1')).toBe(true);
  });

  it('never mistakes a hosted API for a local one', () => {
    expect(isPrivateEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isPrivateEndpoint('https://api.anthropic.com')).toBe(false);
    expect(isPrivateEndpoint('not a url')).toBe(false);
  });
});
