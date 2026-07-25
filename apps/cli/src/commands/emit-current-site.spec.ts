import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCodemap } from '@docstube/codemap';
import { typescriptLanguagePack } from '@docstube/lang-typescript';
import type { AgentTaskSpec, Transcript, WriterClaimLedger } from '@docstube/contracts';
import { createManifestStore, loadConfigFamily, runGenerate, runRefine } from '@docstube/core';
import { emitCurrentSite, emitPersistedSite } from './emit-current-site.ts';

// The wave 2b-iii trust-spine E2E: generate on a real fixture repo → canonical JSON shards
// (kernel ledger + ClaimEvidence embedded) → emitCurrentSite → the theme's interim projection
// renders verified state from ClaimEvidence, never from the removed guarantee ladder.

let repoRoot: string;

const fixtureSource = 'export const DEFAULT_RETRIES = 3;\n';

const mdx = `---
title: "Retry"
description: "Retry defaults."
---

# Retry

<Claim id="v1">\`DEFAULT_RETRIES\` defaults to 3.</Claim>

## Usage

Call the function.
`;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'docstube-emit-e2e-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'retry.ts'), fixtureSource);
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'retry', type: 'module' }));
  await writeFile(
    join(repoRoot, 'docstube.yml'),
    'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\nsite:\n  title: Retry Docs\n'
  );
  await writeFile(
    join(repoRoot, 'ia.yml'),
    'schemaVersion: 1\ntree:\n  - title: Retry\n    slug: retry\n    brief: How retries default.\n'
  );
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

const germanMdx = mdx
  .replace('title: "Retry"', 'title: "Wiederholung"')
  .replace('description: "Retry defaults."', 'description: "Wiederholungs-Standardwerte."')
  .replace('# Retry', '# Wiederholung')
  .replace(
    '<Claim id="v1">`DEFAULT_RETRIES` defaults to 3.</Claim>',
    '<Claim id="v1">`DEFAULT_RETRIES` ist standardmäßig 3.</Claim>'
  )
  .replace('## Usage', '## Verwendung')
  .replace('Call the function.', 'Rufe die Funktion auf.');

const localesConfigYaml =
  'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\n' +
  'site:\n  title: Retry Docs\nlocales:\n  source: en\n  targets: [de]\n';

// The one-claim writer ledger over the fixture symbol, resolved from a fresh codemap.
const buildValueLedger = async (): Promise<WriterClaimLedger> => {
  const codemap = await buildCodemap({
    repoRoot,
    commit: 'a'.repeat(40),
    packs: [typescriptLanguagePack],
    logger: { info: () => {}, warn: () => {} }
  });
  const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash;
  if (symbolHash === undefined) {
    throw new Error('fixture symbol missing from codemap');
  }
  return {
    schemaVersion: 1,
    claims: [
      {
        markerId: 'v1',
        class: 'value',
        predicate: 'DEFAULT_RETRIES defaults to 3',
        proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
        proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue: '3' }]
      }
    ]
  } as WriterClaimLedger;
};

// Scripted transport: passing review, the given source MDX for writer tasks, and — when a
// translation is provided — that MDX for translate tasks. Without one, a translate task CRASHES,
// which both simulates a translator dying mid-run and asserts that refine issues no translations.
const scriptedRunner =
  (input: { sourceMdx: string; ledger: WriterClaimLedger; translation?: string }) =>
  async (spec: AgentTaskSpec): Promise<Transcript> => {
    const base = {
      schemaVersion: 1 as const,
      taskId: spec.id,
      cacheKey: 'test',
      transport: 'replay',
      model: 'scripted',
      observedReads: [{ file: 'src/retry.ts', contentHash: '0'.repeat(64) }],
      usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
      stopReason: 'complete' as const,
      turns: []
    };
    if (spec.kind === 'review-page') {
      return {
        ...base,
        observedReads: [],
        result: {
          type: 'structured',
          value: {
            persona: 'app-developer',
            criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits' }],
            findings: []
          }
        }
      };
    }
    if (spec.kind === 'translate-page') {
      if (input.translation === undefined) {
        throw new Error('translator crashed');
      }
      return { ...base, result: { type: 'mdx', mdx: input.translation } };
    }
    return { ...base, result: { type: 'mdx-ledger', mdx: input.sourceMdx, ledger: input.ledger } };
  };

describe('generate → JSON shards → emit (trust-spine E2E)', () => {
  it('emits the site with claim-count proof frontmatter projected from the shard ClaimEvidence', async () => {
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'a'.repeat(40),
      packs: [typescriptLanguagePack],
      logger: { info: () => {}, warn: () => {} }
    });
    const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash;
    if (symbolHash === undefined) {
      throw new Error('fixture symbol missing from codemap');
    }
    const ledger: WriterClaimLedger = {
      schemaVersion: 1,
      claims: [
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'DEFAULT_RETRIES defaults to 3',
          proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue: '3' }]
        }
      ]
    } as WriterClaimLedger;
    const runTask = async (spec: AgentTaskSpec): Promise<Transcript> => {
      const base = {
        schemaVersion: 1 as const,
        taskId: spec.id,
        cacheKey: 'test',
        transport: 'replay',
        model: 'scripted',
        observedReads: [{ file: 'src/retry.ts', contentHash: '0'.repeat(64) }],
        usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
        stopReason: 'complete' as const,
        turns: []
      };
      if (spec.kind === 'review-page') {
        return {
          ...base,
          observedReads: [],
          result: {
            type: 'structured',
            value: {
              persona: 'app-developer',
              criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits' }],
              findings: []
            }
          }
        };
      }
      return { ...base, result: { type: 'mdx-ledger', mdx, ledger } };
    };

    const summary = await runGenerate({ repoRoot, runTask, toolDescriptors: [] });
    expect(summary.outcome).toBe('passed');

    // Canonical JSON committed state: parseable as JSON, embedding the trust spine.
    const rawIndex = await readFile(join(repoRoot, '.docstube', 'manifest', 'manifest.json'), 'utf8');
    const index = JSON.parse(rawIndex) as { pages: Array<{ id: string }> };
    const pageId = index.pages[0]?.id ?? '';
    const rawShard = await readFile(join(repoRoot, '.docstube', 'manifest', 'pages', 'en', `${pageId}.json`), 'utf8');
    expect(rawShard.endsWith('\n')).toBe(true);
    const shardJson = JSON.parse(rawShard) as {
      mdxContentHash?: string;
      ledger?: { claims: Array<{ correctness: string }> };
      provenance?: { claimEvidence: Array<{ correctness: string }> };
    };
    expect(shardJson.ledger?.claims[0]?.correctness).toBe('checked');
    expect(shardJson.provenance?.claimEvidence[0]?.correctness).toBe('checked');
    // The MDX↔shard binding hash is minted at persistence from the final artifact bytes.
    expect(shardJson.mdxContentHash).toMatch(/^[0-9a-f]{64}$/u);

    // Emit consumes the shard through the interim ClaimEvidence projection. The matched
    // MDX↔shard pair renders its recorded trust state with no binding warnings.
    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    const result = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(result.emitted).toBe(true);
    expect(result.warnings).toEqual([]);
    // Nothing obsolete on a first emit — the reconciler prunes only routes that left the manifest.
    expect(result.pruned).toEqual([]);

    const route = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'retry.mdx'), 'utf8');
    // Literal counts only — the guarantee-label projection is gone (impl-07 finding 4).
    expect(route).not.toContain('docstubeGuarantee');
    expect(route).toContain('docstubeClaimsChecked: 1');
    expect(route).toContain('docstubeClaimsTotal: 1');
    expect(route).toContain('docstubeClaimsContradicted: 0');
    expect(route).not.toContain('docstubeUnverified');
    // The completed primary-gating review earns the reviewed-for label.
    expect(route).toContain('docstubeReviewedFor: "app-developer"');

    // MDX↔SHARD BINDING (wave 2b close final): edit the persisted MDX after persistence and
    // re-emit — the page must render the loud UNVERIFIED state with a warning naming the
    // mismatch, never its stale checked counts over changed prose.
    const persistedMdxPath = join(repoRoot, 'docs-site', 'content', 'en', 'retry.mdx');
    const persistedMdx = await readFile(persistedMdxPath, 'utf8');
    await writeFile(persistedMdxPath, `${persistedMdx}\nEdited after generation.\n`);
    const tampered = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(tampered.emitted).toBe(true);
    expect(tampered.warnings).toHaveLength(1);
    expect(tampered.warnings[0]).toContain('does not match');
    const tamperedRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'retry.mdx'), 'utf8');
    expect(tamperedRoute).toContain('docstubeUnverified: true');
    expect(tamperedRoute).toContain('docstubeClaimsChecked: 0');
    expect(tamperedRoute).toContain('docstubeClaimsTotal: 0');

    // EMIT DIAGNOSTIC LABEL (wave 2b close): one warning channel carries binding failures, dropped
    // authored frontmatter, ignored stale locale files and untranslated routes — so the printed
    // label must NOT borrow the page trust state's name. A dropped frontmatter block leaves the
    // page's proof exactly as verified as it was.
    const printed: string[] = [];
    await emitPersistedSite(repoRoot, family, { info: () => {}, error: (line) => printed.push(line) });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('  emit-warning  ');
    expect(printed[0]?.toLowerCase()).not.toContain('  unverified  ');
  }, 120_000);

  it('locale routes inherit the CANONICAL proof, and a failed retranslation serves the source fallback — never stale locale bytes', async () => {
    await writeFile(
      join(repoRoot, 'docstube.yml'),
      'schemaVersion: 1\ndocType: external-library\npersonas:\n  - id: app-developer\n    description: Builds apps\n' +
        'site:\n  title: Retry Docs\nlocales:\n  source: en\n  targets: [de]\n'
    );
    const codemap = await buildCodemap({
      repoRoot,
      commit: 'a'.repeat(40),
      packs: [typescriptLanguagePack],
      logger: { info: () => {}, warn: () => {} }
    });
    const symbolHash = codemap.symbols.find((symbol) => symbol.name === 'DEFAULT_RETRIES')?.hash;
    if (symbolHash === undefined) {
      throw new Error('fixture symbol missing from codemap');
    }
    const ledger: WriterClaimLedger = {
      schemaVersion: 1,
      claims: [
        {
          markerId: 'v1',
          class: 'value',
          predicate: 'DEFAULT_RETRIES defaults to 3',
          proposedEvidence: [{ kind: 'symbol', symbol: symbolHash }],
          proposedSubscriptions: [{ kind: 'cited-value', symbolHash, valueName: 'DEFAULT_RETRIES', citedValue: '3' }]
        }
      ]
    } as WriterClaimLedger;
    const runnerWith =
      (translation: string) =>
      async (spec: AgentTaskSpec): Promise<Transcript> => {
        const base = {
          schemaVersion: 1 as const,
          taskId: spec.id,
          cacheKey: 'test',
          transport: 'replay',
          model: 'scripted',
          observedReads: [{ file: 'src/retry.ts', contentHash: '0'.repeat(64) }],
          usage: { inputTokens: 1, outputTokens: 1, cacheHit: false },
          stopReason: 'complete' as const,
          turns: []
        };
        if (spec.kind === 'review-page') {
          return {
            ...base,
            observedReads: [],
            result: {
              type: 'structured',
              value: {
                persona: 'app-developer',
                criteria: [{ criterion: 'audience-fit', outcome: 'met', reasoning: 'fits' }],
                findings: []
              }
            }
          };
        }
        if (spec.kind === 'translate-page') {
          return { ...base, result: { type: 'mdx', mdx: translation } };
        }
        return { ...base, result: { type: 'mdx-ledger', mdx, ledger } };
      };

    // Run 1: source page 1/1 checked; the de translation passes and ships.
    const first = await runGenerate({ repoRoot, runTask: runnerWith(germanMdx), toolDescriptors: [] });
    expect(first.outcome).toBe('passed');
    expect(first.translations[0]?.status).toBe('passed');

    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    const firstEmit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(firstEmit.warnings).toEqual([]);

    // RENDITIONS INHERIT CANONICAL PROOF (i18n-lifecycle-v2 decisions 3/4): the de route renders
    // the SOURCE shard's 1/1 checked state, never the 0/0-unverified projection of its own
    // ledgerless locale shard.
    const deRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8');
    expect(deRoute).toContain('docstubeLocale: "de"');
    expect(deRoute).toContain('docstubeClaimsChecked: 1');
    expect(deRoute).toContain('docstubeClaimsTotal: 1');
    expect(deRoute).not.toContain('docstubeUnverified');
    expect(deRoute).not.toContain('docstubeSourceFallback');
    expect(deRoute).toContain('ist standardmäßig 3');
    // TWO-DIMENSION PROOF UI (i18n-lifecycle-v2 decision 3): the rendition inherits the canonical
    // 1/1 checked count AND states, separately, that the TRANSLATION itself has not been reviewed
    // — the bilingual fidelity review of decision 2 is not implemented in 0.1.0, so a translation
    // that flipped a negation must never read as fully checked.
    expect(deRoute).toContain('docstubeTranslationAssurance: "not-reviewed"');
    // The source route is not a translation of anything: no translation dimension at all.
    expect(await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'retry.mdx'), 'utf8')).not.toContain(
      'docstubeTranslationAssurance'
    );
    // LOCALE SECTION ANCHORS (impl-21 fix 3): the de route's section chips reference the de
    // document's own heading anchor (the id Astro derives from "## Verwendung"), mapped
    // positionally onto the canonical section counts — never the source anchor, which does not
    // exist in the rendered de HTML. The source route keeps its own anchors.
    expect(deRoute).toContain('anchor: "verwendung"');
    expect(deRoute).not.toContain('anchor: "usage"');
    const enRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'retry.mdx'), 'utf8');
    expect(enRoute).toContain('anchor: "usage"');

    // Run 2: the retranslation fails (marker renamed v1→v9 — isomorphism violation). The stale de
    // MDX from run 1 remains on disk against the now-hashless de shard.
    const renamed = germanMdx.replace('<Claim id="v1">', '<Claim id="v9">');
    const second = await runGenerate({ repoRoot, runTask: runnerWith(renamed), toolDescriptors: [] });
    expect(second.translations[0]?.status).toBe('flagged');
    const staleDeMdx = await readFile(join(repoRoot, 'docs-site', 'content', 'de', 'retry.mdx'), 'utf8');
    expect(staleDeMdx).toContain('ist standardmäßig 3');

    // STALE LOCALE MDX NEVER SERVED: the de route serves the fresh SOURCE content with the
    // canonical proof and the fallback marker; the stale bytes are ignored and reported.
    const secondEmit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(secondEmit.warnings.some((warning) => warning.includes('stale locale MDX'))).toBe(true);
    const fallbackRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8');
    expect(fallbackRoute).toContain('docstubeSourceFallback: true');
    expect(fallbackRoute).toContain('defaults to 3');
    expect(fallbackRoute).not.toContain('ist standardmäßig 3');
    expect(fallbackRoute).toContain('docstubeClaimsChecked: 1');
    expect(fallbackRoute).toContain('docstubeClaimsTotal: 1');
    expect(fallbackRoute).not.toContain('docstubeUnverified');
    // A fallback route already says "not yet translated" — the translation dimension is that
    // notice, never additionally a "not yet reviewed" line about a translation nobody is serving.
    expect(fallbackRoute).not.toContain('docstubeTranslationAssurance');
    // A fallback route renders the SOURCE headings, so it keeps the canonical anchors.
    expect(fallbackRoute).toContain('anchor: "usage"');
    expect(fallbackRoute).not.toContain('anchor: "verwendung"');
    // The raw markdown mirror serves the fallback bytes too, never the stale translation.
    const deMirror = await readFile(join(repoRoot, 'docs-site', 'public', 'de', 'retry.md'), 'utf8');
    expect(deMirror).not.toContain('ist standardmäßig 3');
  }, 180_000);

  it('a translator transport crash is NONBLOCKING: the source page ships and emission makes the stale locale inert', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), localesConfigYaml);
    const ledger = await buildValueLedger();

    // Run 1: source + translation both ship; the de route serves the translated bytes.
    const first = await runGenerate({
      repoRoot,
      runTask: scriptedRunner({ sourceMdx: mdx, ledger, translation: germanMdx }),
      toolDescriptors: []
    });
    expect(first.outcome).toBe('passed');
    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    const firstEmit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(firstEmit.warnings).toEqual([]);
    expect(await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8')).toContain(
      'ist standardmäßig 3'
    );

    // Run 2: the source page CHANGES and the translator crashes AFTER the source artifact
    // persisted — exactly the window where run 1's hash-bearing de shard (old
    // sourceContentRevision) survives against a fresh canonical shard.
    const updatedMdx = mdx.replace('Call the function.', 'Call the function with options.');
    // A translator transport failure is NONBLOCKING (impl-23 finding 4): the run completes, the
    // source page ships, and only the de locale is flagged.
    const second = await runGenerate({
      repoRoot,
      runTask: scriptedRunner({ sourceMdx: updatedMdx, ledger }),
      toolDescriptors: []
    });
    expect(second.outcome).toBe('flagged');
    expect(second.pages.every((page) => page.status === 'passed')).toBe(true);
    expect(second.translations).toEqual([expect.objectContaining({ locale: 'de', status: 'flagged' })]);
    const staleDe = await readFile(join(repoRoot, 'docs-site', 'content', 'de', 'retry.mdx'), 'utf8');
    expect(staleDe).toContain('ist standardmäßig 3');

    // The pipeline never invalidated the locale shard — the EMISSION revision gate compares its
    // recorded canonical revision with the current canonical shard, refuses the stale prose, and
    // serves the fresh source under the locale route with a warning naming the staleness.
    const secondEmit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(secondEmit.warnings.some((warning) => warning.includes('stale'))).toBe(true);
    const fallbackRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8');
    expect(fallbackRoute).toContain('docstubeSourceFallback: true');
    expect(fallbackRoute).toContain('Call the function with options.');
    expect(fallbackRoute).not.toContain('ist standardmäßig 3');
    expect(fallbackRoute).not.toContain('docstubeUnverified');
  }, 180_000);

  it('a configured locale with NO shard for a page still gets a source-fallback route — never a 404', async () => {
    // Generate WITHOUT any target locale: only en shards exist.
    const ledger = await buildValueLedger();
    const first = await runGenerate({
      repoRoot,
      runTask: scriptedRunner({ sourceMdx: mdx, ledger }),
      toolDescriptors: []
    });
    expect(first.outcome).toBe('passed');

    // The user now adds `de` to docstube.yml and emits before generate ever translated anything.
    // i18n-lifecycle-v2 decision 1: no 404s, no hidden locales — every configured locale shows
    // EVERYTHING, with untranslated pages marked. A missing locale shard must therefore behave
    // exactly like a failed one: source bytes, canonical proof, the not-yet-translated notice.
    await writeFile(join(repoRoot, 'docstube.yml'), localesConfigYaml);
    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    const index = await store.readIndex();
    expect(index?.pages).toHaveLength(1);
    for (const page of index?.pages ?? []) {
      expect(await store.readPageShard({ locale: 'de', pageId: page.id })).toBeUndefined();
    }

    const emit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(emit.emitted).toBe(true);
    expect(emit.warnings.some((warning) => warning.includes('no translation exists yet'))).toBe(true);

    // Every route exists under /de/ as a source fallback with the notice and the canonical proof.
    const deRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8');
    expect(deRoute).toContain('docstubeLocale: "de"');
    expect(deRoute).toContain('docstubeSourceFallback: true');
    expect(deRoute).toContain('defaults to 3');
    expect(deRoute).toContain('docstubeClaimsChecked: 1');
    expect(deRoute).toContain('docstubeClaimsTotal: 1');
    expect(deRoute).not.toContain('docstubeUnverified');
    // The locale nav lists the page too, so nothing is hidden from the de reader.
    const siteData = await readFile(join(repoRoot, 'docs-site', 'src', 'site-data.mjs'), 'utf8');
    expect(siteData).toContain('"/de/retry/"');
  }, 180_000);

  it('locale revision gate: refine updating only source artifacts makes the old translation stale at emission', async () => {
    await writeFile(join(repoRoot, 'docstube.yml'), localesConfigYaml);
    const ledger = await buildValueLedger();
    const first = await runGenerate({
      repoRoot,
      runTask: scriptedRunner({ sourceMdx: mdx, ledger, translation: germanMdx }),
      toolDescriptors: []
    });
    expect(first.outcome).toBe('passed');
    const family = await loadConfigFamily(repoRoot);
    const store = createManifestStore(repoRoot, family.config.versions.current);
    expect((await emitCurrentSite({ workspaceDir: repoRoot, family, store })).warnings).toEqual([]);

    // refine rewrites the SOURCE page only — it issues no translate tasks (the scripted runner
    // would crash on one), so the locale shard is untouched by design, not by accident.
    const refinedMdx = mdx.replace('Call the function.', 'Call the function early.');
    const refined = await runRefine({
      repoRoot,
      runTask: scriptedRunner({ sourceMdx: refinedMdx, ledger }),
      toolDescriptors: []
    });
    expect(refined.refined).toHaveLength(1);

    // The untouched locale shard's recorded canonical revision no longer matches the refined
    // canonical shard: the route serves the refined source content as the fallback.
    const emit = await emitCurrentSite({ workspaceDir: repoRoot, family, store });
    expect(emit.warnings.some((warning) => warning.includes('stale'))).toBe(true);
    const deRoute = await readFile(join(repoRoot, 'docs-site', 'src', 'pages', 'de', 'retry.mdx'), 'utf8');
    expect(deRoute).toContain('docstubeSourceFallback: true');
    expect(deRoute).toContain('Call the function early.');
    expect(deRoute).not.toContain('ist standardmäßig 3');
  }, 180_000);
});
