import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFixturePage,
  codemapSchema,
  contentHash,
  docstubeConfigSchema,
  idPrefixes,
  mintId
} from '@docstube/contracts';
import type { BlockEntity, ClaimEntity, PageEntity } from '@docstube/contracts';
import { definePlugin } from '@docstube/plugin-sdk';
import type { DocstubePlugin, PluginFs } from '@docstube/plugin-sdk';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { liftClaimGroundedBlocks, recomputeRollups, runVerifiers } from './verify-page.ts';

const emptyProvenance = { sources: [], seedContext: [], observedReads: [], verifications: [], reviews: [] };

const proseBlock = (text: string, claims: ClaimEntity[] = []): BlockEntity => ({
  id: mintId(idPrefixes.block),
  kind: 'block',
  blockType: 'paragraph',
  contentHash: contentHash(text),
  variants: [],
  claims,
  guarantee: 'scored',
  provenance: emptyProvenance
});

const claim = (guarantee: ClaimEntity['guarantee']): ClaimEntity => ({
  id: mintId(idPrefixes.claim),
  kind: 'claim',
  text: 'retry stops after the configured attempts',
  anchor: { quote: 'stops after the configured attempts', prefix: '', suffix: '' },
  claimClass: 'behavioral',
  guarantee
});

const pageWith = (blocks: BlockEntity[]): PageEntity => {
  const fixture = buildFixturePage();
  return { ...fixture, preamble: [], sections: [{ ...fixture.sections[0]!, blocks }] };
};

describe('recomputeRollups (provable-only, founder decision 2026-07-17)', () => {
  it('claimless narrative never drags a proven code block down', () => {
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'proven' as const };
    const page = recomputeRollups(pageWith([proseBlock('Some intro text.'), code]));
    expect(page.sections[0]?.guarantee).toBe('proven');
    expect(page.guarantee).toBe('proven');
  });

  it('an unproven provable block still holds the page at scored', () => {
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'scored' as const };
    const page = recomputeRollups(pageWith([code]));
    expect(page.guarantee).toBe('scored');
  });

  it('a page with nothing provable is scored, and ODD blocks are excluded from the roll-up', () => {
    const odd = { ...proseBlock('why we deprecated X', [claim('out-of-domain')]), guarantee: 'out-of-domain' as const };
    const code = { ...proseBlock('npm install'), blockType: 'code-example' as const, guarantee: 'proven' as const };
    expect(recomputeRollups(pageWith([proseBlock('Only narrative.')])).guarantee).toBe('scored');
    expect(recomputeRollups(pageWith([odd, code])).guarantee).toBe('proven');
  });
});

describe('liftClaimGroundedBlocks', () => {
  it('a prose block whose every claim grounded becomes proven and the page follows', () => {
    const grounded = proseBlock('It stops after the configured attempts.', [claim('proven')]);
    const page = liftClaimGroundedBlocks(pageWith([grounded, proseBlock('Narrative.')]));
    expect(page.sections[0]?.blocks[0]?.guarantee).toBe('proven');
    expect(page.guarantee).toBe('proven');
  });

  it('one ungrounded claim keeps the block (and page) at scored', () => {
    const half = proseBlock('Half grounded.', [claim('proven'), claim('scored')]);
    const page = liftClaimGroundedBlocks(pageWith([half]));
    expect(page.sections[0]?.blocks[0]?.guarantee).toBe('scored');
    expect(page.guarantee).toBe('scored');
  });
});

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
