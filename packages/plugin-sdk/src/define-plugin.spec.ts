import { describe, expect, it } from 'vitest';
import { definePlugin, isDocstubePlugin } from './define-plugin.ts';

describe('definePlugin', () => {
  it('validates the manifest and brands the plugin', () => {
    const plugin = definePlugin({
      apiVersion: 1,
      name: 'docstube-plugin-example',
      version: '0.1.0',
      capabilities: [{ kind: 'verifier', ids: ['example-check'] }],
      register(host) {
        host.verifier({
          id: 'example-check',
          title: 'Example check',
          scope: 'page',
          localeScope: 'per-locale',
          proves: false,
          verify: async () => ({
            verifier: 'example-check',
            plugin: 'docstube-plugin-example',
            status: 'pass',
            findings: [],
            coveredEntityIds: []
          })
        });
      }
    });
    expect(isDocstubePlugin(plugin)).toBe(true);
    expect(plugin.manifest.permissions).toEqual({ network: false, exec: [], writableRoots: [] });
  });

  it('rejects a plugin with no declared capabilities', () => {
    expect(() =>
      definePlugin({
        apiVersion: 1,
        name: 'docstube-plugin-empty',
        version: '0.1.0',
        capabilities: [],
        register: () => {}
      })
    ).toThrow(/capabilities/u);
  });

  it('rejects an unsupported apiVersion with a readable error', () => {
    expect(() =>
      definePlugin({
        // @ts-expect-error — intentionally wrong version
        apiVersion: 2,
        name: 'docstube-plugin-future',
        version: '0.1.0',
        capabilities: [{ kind: 'verifier', ids: ['x'] }],
        register: () => {}
      })
    ).toThrow(/apiVersion/u);
  });

  it('does not brand arbitrary objects', () => {
    expect(isDocstubePlugin({ manifest: {}, register: () => {} })).toBe(false);
  });
});
