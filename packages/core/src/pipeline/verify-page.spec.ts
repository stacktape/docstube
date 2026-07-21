import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFixturePage, codemapSchema, docstubeConfigSchema } from '@docstube/contracts';
import { definePlugin } from '@docstube/plugin-sdk';
import type { DocstubePlugin, PluginFs } from '@docstube/plugin-sdk';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { runVerifiers } from './verify-page.ts';

// The guarantee roll-up/lift ladder is gone (wave 2b-iii demolition): trust state lives on the
// claim ledger (verify-claims.spec.ts); this spec covers the verifier host mechanics only.

const pluginWith = (verify: (fs: PluginFs) => Promise<void>): DocstubePlugin =>
  definePlugin({
    apiVersion: 1,
    name: 'docstube-plugin-fs-test',
    version: '0.0.1',
    permissions: { writableRoots: ['cache'] },
    capabilities: [{ kind: 'verifier', ids: ['fs-check'] }],
    register: (host) => {
      host.verifier({
        id: 'fs-check',
        title: 'fs check',
        scope: 'page',
        localeScope: 'per-locale',
        proves: false,
        verify: async (ctx) => {
          await verify(ctx.fs);
          return {
            verifier: 'fs-check',
            plugin: 'docstube-plugin-fs-test',
            status: 'pass',
            findings: [],
            coveredEntityIds: []
          };
        }
      });
    }
  });

describe('plugin fs writableRoots enforcement', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docstube-pluginfs-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const runWith = async (plugin: DocstubePlugin) => {
    const host = createPluginHost();
    await host.registerPlugin(plugin, 'local', './fs-test');
    const page = buildFixturePage();
    return runVerifiers({
      repoRoot,
      config: docstubeConfigSchema.parse({
        schemaVersion: 1,
        docType: 'external-library',
        personas: [{ id: 'dev', description: 'a developer' }],
        site: { title: 'x' }
      }),
      codemap: codemapSchema.parse({ schemaVersion: 1, commit: 'a'.repeat(40), symbols: [] }),
      glossary: { schemaVersion: 1, terms: [] },
      host,
      artifacts: [{ page, mdx: '# x', mdxPath: 'content/en/x.mdx', locale: 'en', version: 'latest' }],
      includeSiteScope: false
    });
  };

  it('rejects traversal that resolves outside the declared root, on the RESOLVED path', async () => {
    const results = await runWith(pluginWith((fs) => fs.writeFile('cache/../../escape.txt', 'out')));
    expect(results[0]?.status).toBe('error');
    expect(results[0]?.findings[0]?.message).toContain('outside its declared writableRoots');
    await expect(access(join(repoRoot, '..', 'escape.txt'))).rejects.toThrow(/ENOENT/);
  });

  it('allows writes inside a declared root, including nested paths', async () => {
    const results = await runWith(pluginWith((fs) => fs.writeFile('cache/sub/ok.txt', 'in')));
    expect(results[0]?.status).toBe('pass');
    await access(join(repoRoot, 'cache', 'sub', 'ok.txt'));
  });
});
