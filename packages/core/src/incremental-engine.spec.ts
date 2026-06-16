import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestSchema } from '@docstube/contracts';
import type { Manifest, ManifestPage, PackageVersion } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import {
  createPageProvenance,
  createSourceSnapshot,
  detectChangedSources,
  hashSeedContext,
  readManifestFile,
  resolveDirtyPages,
  runTopologyConsistencyPass,
  updateManifest,
  writeManifestFile
} from './incremental-engine';

const generatedWith: PackageVersion = { name: 'docstube', version: '0.0.0' };

const page = (input: {
  id: string;
  path: string;
  provenance: ManifestPage['provenance'];
  title?: string;
}): ManifestPage =>
  manifestSchema.parse({
    generatedWith,
    pages: [
      {
        id: input.id,
        path: input.path,
        title: input.title ?? input.id,
        status: 'passed',
        sections: [],
        provenance: input.provenance
      }
    ]
  }).pages[0]!;

const manifestFromPages = (pages: readonly ManifestPage[]): Manifest => manifestSchema.parse({ generatedWith, pages });

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-incremental-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('incremental dirty detection', () => {
  it('detects normalized source changes and dirties the exact affected page set', () => {
    const previous = [
      createSourceSnapshot({
        path: 'src/auth.ts',
        content: 'export const login = () => true;\n',
        symbols: { login: 'export const login = () => true;' }
      }),
      createSourceSnapshot({
        path: 'src/billing.ts',
        content: 'export const invoice = () => true;\n',
        symbols: { invoice: 'export const invoice = () => true;' }
      })
    ];
    const current = [
      createSourceSnapshot({
        path: 'src/auth.ts',
        content: 'export const login = () => false;   \r\n',
        symbols: { login: 'export const login = () => false;' }
      }),
      previous[1]!
    ];
    const changes = detectChangedSources({ previous, current });

    expect(changes).toMatchObject([{ path: 'src/auth.ts', kind: 'modified', changedSymbols: ['login'] }]);

    const manifest = manifestFromPages([
      page({
        id: 'overview',
        path: 'overview.mdx',
        provenance: createPageProvenance({ seedContext: { page: 'overview' }, reads: ['src/auth.ts'] })
      }),
      page({
        id: 'reference/auth',
        path: 'reference/auth.mdx',
        provenance: createPageProvenance({
          seedContext: { page: 'auth' },
          citations: [{ path: 'src/auth.ts', symbol: 'login' }]
        })
      }),
      page({
        id: 'reference/billing',
        path: 'reference/billing.mdx',
        provenance: createPageProvenance({
          seedContext: { page: 'billing' },
          reads: ['src/billing.ts'],
          citations: [{ path: 'src/billing.ts', symbol: 'invoice' }]
        })
      })
    ]);

    const result = resolveDirtyPages({ manifest, changedSources: changes });

    expect(result.dirtyPageIds).toEqual(['overview', 'reference/auth']);
    expect(result.skippedPageIds).toEqual(['reference/billing']);
    expect(result.symbolToPages).toEqual({ 'src/auth.ts#login': ['overview', 'reference/auth'] });
  });

  it('regenerates changed seed-context candidates and flags corrupt provenance instead of skipping', () => {
    const stableSeedHash = hashSeedContext({ page: 'overview', symbols: ['login'] });
    const manifest = manifestFromPages([
      page({
        id: 'overview',
        path: 'overview.mdx',
        provenance: { seedHash: stableSeedHash, reads: [], citations: [] }
      })
    ]);
    const result = resolveDirtyPages({
      manifest,
      changedSymbols: [{ path: 'src/auth.ts', symbol: 'login' }],
      candidatePageIds: ['overview'],
      currentSeedHashes: { overview: hashSeedContext({ page: 'overview', symbols: ['login', 'logout'] }) }
    });

    expect(result.decisions).toMatchObject([
      {
        pageId: 'overview',
        action: 'regenerate',
        reasons: ['seed-context-changed'],
        uncertain: true
      }
    ]);

    const corruptResult = resolveDirtyPages({
      manifest: { pages: [{ id: 'overview', path: 'overview.mdx', status: 'passed' }] },
      changedSymbols: [{ path: 'src/auth.ts', symbol: 'login' }],
      candidatePageIds: ['overview']
    });

    expect(corruptResult.decisions).toMatchObject([{ pageId: 'overview', action: 'flag', uncertain: true }]);
    expect(corruptResult.findings).toMatchObject([{ code: 'provenance-corrupt', pageId: 'overview' }]);
  });
});

describe('topology consistency pass', () => {
  it('reports broken nav references, stale cross-page links, and missing glossary terms', () => {
    const manifest = updateManifest({
      generatedWith,
      pages: [
        {
          id: 'guide/intro',
          path: 'guide/intro.mdx',
          title: 'Intro',
          status: 'passed',
          provenance: createPageProvenance({ seedContext: { page: 'intro' } })
        },
        {
          id: 'guide/reference',
          path: 'guide/reference.mdx',
          title: 'Reference',
          status: 'passed',
          provenance: createPageProvenance({ seedContext: { page: 'reference' } })
        }
      ]
    });

    const findings = runTopologyConsistencyPass({
      ia: {
        version: 1,
        nav: [
          {
            id: 'guide',
            title: 'Guide',
            children: [
              { id: 'intro', title: 'Intro', path: 'guide/intro.mdx' },
              { id: 'missing', title: 'Missing', path: 'guide/missing.mdx' }
            ]
          }
        ]
      },
      glossary: {
        version: 1,
        terms: [{ id: 'defined-term', term: 'Defined term', definition: 'A known term.' }]
      },
      manifest,
      pages: [
        {
          id: 'guide/intro',
          path: 'guide/intro.mdx',
          content: '[Old page](./old-page.mdx)\n\n{{glossary:missing-term}}',
          glossaryTerms: ['defined-term']
        }
      ],
      regeneratedPageIds: ['guide/intro']
    });

    expect(findings.map((finding) => finding.code)).toEqual([
      'nav-reference-missing',
      'cross-page-link-stale',
      'glossary-term-missing'
    ]);
  });
});

describe('manifest updates', () => {
  it('writes a portable committed-friendly manifest that round-trips through the schema', async () => {
    await withTempDir(async (dir) => {
      const provenance = createPageProvenance({
        seedContext: { symbols: ['createApp'], page: 'overview' },
        reads: ['src/z.ts', 'src/a.ts', 'src/a.ts'],
        citations: [
          { path: 'src/z.ts', symbol: 'createApp' },
          { path: 'src/a.ts' },
          { path: 'src/z.ts', symbol: 'createApp' }
        ]
      });
      const manifest = updateManifest({
        generatedWith,
        pages: [{ id: 'overview', path: 'overview.mdx', status: 'passed', provenance }]
      });
      const manifestPath = join(dir, '.docstube', 'manifest.yml');

      await writeManifestFile(manifestPath, manifest);

      const text = await readFile(manifestPath, 'utf8');
      const loaded = await readManifestFile(manifestPath);

      expect(text).toContain('docstube provenance manifest');
      expect(text).not.toContain(dir);
      expect(loaded).toEqual(manifest);
      expect(loaded.pages[0]?.provenance.reads).toEqual(['src/a.ts', 'src/z.ts']);
      expect(loaded.pages[0]?.provenance.citations).toEqual([
        { path: 'src/a.ts' },
        { path: 'src/z.ts', symbol: 'createApp' }
      ]);
    });
  });
});
