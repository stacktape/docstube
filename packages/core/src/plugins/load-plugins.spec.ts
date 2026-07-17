import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocstubeConfig } from '@docstube/contracts';
import { createPluginHost } from './plugin-host.ts';
import { loadConfiguredPlugins } from './load-plugins.ts';

// Plugin path resolution: relative specifiers resolve against the target repo, absolute
// specifiers are used as-is (joining them onto repoRoot corrupts the path). The scripted plugin
// module carries the Symbol.for-registered brand, so it needs no SDK import from the temp dir.

const pluginModule = (name: string, verifierId: string): string => `const brand = Symbol.for('docstube.plugin');
export default {
  [brand]: true,
  manifest: {
    apiVersion: 1,
    name: '${name}',
    version: '0.1.0',
    capabilities: [{ kind: 'verifier', ids: ['${verifierId}'] }],
    permissions: { network: false, exec: [], writableRoots: [] }
  },
  register(host) {
    host.verifier({
      id: '${verifierId}',
      title: 'fixture',
      scope: 'page',
      localeScope: 'per-locale',
      proves: false,
      verify: async () => ({
        verifier: '${verifierId}',
        plugin: '${name}',
        status: 'pass',
        findings: [],
        coveredEntityIds: []
      })
    });
  }
};
`;

const configWith = (plugins: string[]): DocstubeConfig => ({ plugins }) as unknown as DocstubeConfig;

let repoRoot: string;
let outsideDir: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-plugins-repo-'));
  outsideDir = await mkdtemp(join(tmpdir(), 'docstube-plugins-abs-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe('loadConfiguredPlugins', () => {
  it('loads a relative local plugin from the target repo', async () => {
    await mkdir(join(repoRoot, 'plugins'), { recursive: true });
    await writeFile(join(repoRoot, 'plugins', 'local.mjs'), pluginModule('docstube-plugin-rel', 'rel-check'), 'utf8');
    const host = createPluginHost();
    await loadConfiguredPlugins(host, configWith(['./plugins/local.mjs']), repoRoot);
    expect(host.verifiers().map((entry) => entry.definition.id)).toEqual(['rel-check']);
    expect(host.plugins()[0]?.source).toBe('local');
  });

  it('loads an absolute plugin path as-is instead of joining it onto repoRoot', async () => {
    const absolutePath = join(outsideDir, 'abs.mjs');
    await writeFile(absolutePath, pluginModule('docstube-plugin-abs', 'abs-check'), 'utf8');
    const host = createPluginHost();
    await loadConfiguredPlugins(host, configWith([absolutePath]), repoRoot);
    expect(host.verifiers().map((entry) => entry.definition.id)).toEqual(['abs-check']);
    expect(host.plugins()[0]?.source).toBe('local');
  });
});
