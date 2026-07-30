import { describe, expect, it } from 'vitest';
import { agentRoleForTaskKind, agentRoleSchema, docstubeConfigSchema, fixtureConfigInput } from '@docstube/contracts';
import {
  describeRoleOverrides,
  resolveRoleRouting,
  resolveRunRoleRoutings,
  resolveTransportId,
  roleRoutingKey
} from './agent-role-routing.ts';

// THE RESOLUTION ORDER, asserted once: per-role override → top-level agents.transport/model →
// the transport's own default model. Everything that routes a task or checks a credential reads
// this module, so these are the tests that keep the two in sync.

const config = (agents: Record<string, unknown>) => docstubeConfigSchema.parse({ ...fixtureConfigInput, agents });

describe('resolveTransportId', () => {
  it('uses the config transport when no override is set', () => {
    expect(resolveTransportId(config({ transport: 'codex-cli' }), {})).toBe('codex-cli');
    expect(resolveTransportId(config({ transport: 'codex-cli' }), { DOCSTUBE_TRANSPORT_OVERRIDE: '' })).toBe(
      'codex-cli'
    );
  });

  it('lets DOCSTUBE_TRANSPORT_OVERRIDE reach the internal-only transports', () => {
    expect(resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'replay' })).toBe('replay');
    expect(resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'google' })).toBe('google');
  });

  it('rejects unknown override values instead of passing them through', () => {
    expect(() => resolveTransportId(config({}), { DOCSTUBE_TRANSPORT_OVERRIDE: 'gemini-cli' })).toThrow(
      /not a known transport/
    );
  });
});

describe('resolveRoleRouting', () => {
  it('inherits BOTH the top-level transport and model for an unset role', () => {
    const parsed = config({ transport: 'anthropic-api', model: 'claude-sonnet-5' });
    for (const role of agentRoleSchema.options) {
      expect(resolveRoleRouting(parsed, role, {})).toMatchObject({
        transportId: 'anthropic-api',
        model: 'claude-sonnet-5',
        overridden: false
      });
    }
  });

  it('falls back to the transport default model when nothing sets one', () => {
    expect(resolveRoleRouting(config({ transport: 'claude-cli' }), 'writer', {})).toMatchObject({
      transportId: 'claude-cli',
      model: 'sonnet'
    });
  });

  it('reports a config problem (never a guessed model) for a transport with no default', () => {
    const routing = resolveRoleRouting(config({ transport: 'codex-cli' }), 'writer', {});
    expect(routing.model).toBeUndefined();
    expect(routing.configProblem).toContain('agents.model');
  });

  it('a model-only override inherits the transport', () => {
    const parsed = config({
      transport: 'anthropic-api',
      model: 'claude-sonnet-5',
      roles: { reviewer: { model: 'claude-haiku-5' } }
    });
    expect(resolveRoleRouting(parsed, 'reviewer', {})).toMatchObject({
      transportId: 'anthropic-api',
      model: 'claude-haiku-5',
      overridden: true
    });
    expect(resolveRoleRouting(parsed, 'writer', {})).toMatchObject({
      transportId: 'anthropic-api',
      model: 'claude-sonnet-5',
      overridden: false
    });
  });

  it('a transport-only override inherits the model', () => {
    const parsed = config({
      transport: 'anthropic-api',
      model: 'shared-model',
      roles: { translator: { transport: 'openai-compatible' } }
    });
    expect(resolveRoleRouting(parsed, 'translator', {})).toMatchObject({
      transportId: 'openai-compatible',
      model: 'shared-model',
      overridden: true
    });
  });

  it('names the ROLE when a role-overridden transport has no default model', () => {
    const parsed = config({ transport: 'claude-cli', roles: { translator: { transport: 'codex-cli' } } });
    const translator = resolveRoleRouting(parsed, 'translator', {});
    expect(translator.model).toBeUndefined();
    expect(translator.configProblem).toContain('agents.roles.translator.model');
    // The unset roles are untouched by the broken one.
    expect(resolveRoleRouting(parsed, 'writer', {}).model).toBe('sonnet');
  });

  it('keeps the top-level credential settings only while the role stays on the top-level transport', () => {
    const parsed = config({
      transport: 'openai-compatible',
      model: 'local-model',
      apiKeyEnv: 'MY_OPENAI_KEY',
      baseUrl: 'http://localhost:11434/v1',
      roles: { reviewer: { transport: 'anthropic-api', model: 'claude-haiku-5' } }
    });
    expect(resolveRoleRouting(parsed, 'writer', {})).toMatchObject({
      apiKeyEnv: 'MY_OPENAI_KEY',
      baseUrl: 'http://localhost:11434/v1'
    });
    // A role on ANOTHER provider must not be handed this provider's key or base URL.
    const reviewer = resolveRoleRouting(parsed, 'reviewer', {});
    expect(reviewer.apiKeyEnv).toBeUndefined();
    expect(reviewer.baseUrl).toBeUndefined();
  });

  it('lets DOCSTUBE_TRANSPORT_OVERRIDE win for EVERY role, role overrides included', () => {
    const parsed = config({
      transport: 'claude-cli',
      model: 'sonnet',
      roles: { reviewer: { transport: 'openai-compatible' } }
    });
    for (const role of agentRoleSchema.options) {
      expect(resolveRoleRouting(parsed, role, { DOCSTUBE_TRANSPORT_OVERRIDE: 'replay' }).transportId).toBe('replay');
    }
  });
});

describe('resolveRunRoleRoutings', () => {
  it('covers every routable role, writer first', () => {
    const routings = resolveRunRoleRoutings(config({}), {});
    expect(routings.map((routing) => routing.role)).toEqual([...agentRoleSchema.options]);
    expect(routings[0]?.role).toBe('writer');
  });

  it('gives roles that resolve identically the same routing key', () => {
    const parsed = config({ model: 'sonnet', roles: { reviewer: { model: 'haiku' }, translator: { model: 'haiku' } } });
    const [writer, reviewer, translator] = ['writer', 'reviewer', 'translator'].map((role) =>
      resolveRoleRouting(parsed, role as 'writer', {})
    );
    expect(roleRoutingKey(reviewer!)).toBe(roleRoutingKey(translator!));
    expect(roleRoutingKey(reviewer!)).not.toBe(roleRoutingKey(writer!));
  });
});

describe('describeRoleOverrides', () => {
  it('reports only the roles that moved, grouped by where they moved to', () => {
    const parsed = config({
      transport: 'claude-cli',
      model: 'sonnet',
      roles: { reviewer: { model: 'haiku' }, translator: { model: 'haiku' } }
    });
    expect(describeRoleOverrides(resolveRunRoleRoutings(parsed, {}))).toEqual([
      'reviewer, translator → claude-cli · haiku'
    ]);
    expect(describeRoleOverrides(resolveRunRoleRoutings(config({ model: 'sonnet' }), {}))).toEqual([]);
  });
});

describe('agentRoleForTaskKind', () => {
  it('maps every task kind the pipeline issues onto a role', () => {
    expect(agentRoleForTaskKind('write-page')).toBe('writer');
    expect(agentRoleForTaskKind('review-page')).toBe('reviewer');
    expect(agentRoleForTaskKind('translate-page')).toBe('translator');
    expect(agentRoleForTaskKind('propose-ia')).toBe('architect');
    expect(agentRoleForTaskKind('extract-theme-tokens')).toBe('extractor');
    expect(agentRoleForTaskKind('audit-extract-claims')).toBe('extractor');
    expect(agentRoleForTaskKind('categorize-feedback')).toBe('extractor');
    expect(agentRoleForTaskKind('preflight')).toBe('writer');
  });

  it('routes an unregistered kind as the writer — never onto the cheapest role by accident', () => {
    expect(agentRoleForTaskKind('some-plugin-task')).toBe('writer');
  });
});
