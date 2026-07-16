import { describe, expect, it } from 'vitest';
import { definePlugin } from '@docstube/plugin-sdk';
import { CoreError } from '../errors.ts';
import { createPluginHost } from './plugin-host.ts';

const makeVerifierPlugin = (name: string, verifierId: string, registeredId = verifierId) =>
  definePlugin({
    apiVersion: 1,
    name,
    version: '0.1.0',
    capabilities: [{ kind: 'verifier', ids: [verifierId] }],
    register(host) {
      host.verifier({
        id: registeredId,
        title: 'test',
        scope: 'page',
        localeScope: 'per-locale',
        proves: false,
        verify: async () => ({
          verifier: registeredId,
          plugin: name,
          status: 'pass',
          findings: [],
          coveredEntityIds: []
        })
      });
    }
  });

describe('plugin host', () => {
  it('registers a plugin and exposes its verifier', async () => {
    const host = createPluginHost();
    await host.registerPlugin(makeVerifierPlugin('docstube-plugin-a', 'check-a'), 'local', './a.ts');
    expect(host.verifiers().map((entry) => entry.definition.id)).toEqual(['check-a']);
    expect(host.plugins()[0]?.source).toBe('local');
  });

  it('rejects registration of an undeclared capability', async () => {
    const host = createPluginHost();
    const sneaky = makeVerifierPlugin('docstube-plugin-sneaky', 'declared-check', 'other-check');
    await expect(host.registerPlugin(sneaky, 'npm', 'docstube-plugin-sneaky')).rejects.toThrow(CoreError);
  });

  it('warns when a declared capability is never registered', async () => {
    const host = createPluginHost();
    const lazy = definePlugin({
      apiVersion: 1,
      name: 'docstube-plugin-lazy',
      version: '0.1.0',
      capabilities: [{ kind: 'verifier', ids: ['never-registered'] }],
      register: () => {}
    });
    await host.registerPlugin(lazy, 'npm', 'docstube-plugin-lazy');
    expect(host.warnings()[0]).toContain('never-registered');
  });

  it('rejects duplicate ids across plugins', async () => {
    const host = createPluginHost();
    await host.registerPlugin(makeVerifierPlugin('docstube-plugin-a', 'check-a'), 'npm', 'a');
    await expect(host.registerPlugin(makeVerifierPlugin('docstube-plugin-b', 'check-a'), 'npm', 'b')).rejects.toThrow(
      /duplicate verifier/
    );
  });
});
