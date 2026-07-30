import { describe, expect, it } from 'vitest';
import { docstubeConfigSchema, fixtureConfigInput } from '@docstube/contracts';
import {
  credentialEnvVarPresent,
  isPrivateEndpoint,
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
