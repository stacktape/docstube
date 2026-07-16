import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type {
  BlockEntity,
  Finding,
  Flag,
  ManifestIndex,
  PageEntity,
  PageShard,
  Provenance,
  ToolDescriptor
} from '@docstube/contracts';
import { contentHash, hashValue, idPrefixes, mintId, walkIaNodes } from '@docstube/contracts';
import { buildCodemap } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { docstubeVersion } from '../version.ts';
import { CoreError } from '../errors.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { errorFindings, runVerifiers } from './verify-page.ts';
import { loadContextFiles } from './context-files.ts';
import { generatePage } from './page-runner.ts';
import type { PageRunContext, TaskRunner } from './page-runner.ts';
import { applyFlagAnswers, collectOpenQuestionKeys, loadKnowledge } from './tribal-knowledge.ts';
import { resolveCommit } from './generate.ts';

// The maintain/refresh stage (PRODUCT §3.5 stage 8): symbol-hash diff → provenance lookup → only
// affected pages regenerate. Bias rule: uncertain provenance ⇒ regenerate, never assume. A
// topology pass (site-scope verifiers over ALL pages) restores cross-page consistency after
// partial regeneration.
//
// TODO(v2): regenerate at block/section granularity — blocks carry their own provenance, so the
// affected-entity set is already computable per block; v1 regenerates whole pages.

export type RefreshOptions = {
  repoRoot: string;
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  runId?: string | undefined;
  maxAttemptsPerPage?: number | undefined;
};

export type RefreshSummary = {
  runId: string;
  outcome: 'passed' | 'flagged';
  // Slugs of the pages that were regenerated this run.
  regenerated: string[];
  unchangedCount: number;
  siteFindings: Finding[];
  warnings: string[];
};

const readOptionalFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

// Every provenance record on the page: the page's own plus per-block and per-claim ones — a match
// on any of them makes the whole page affected in v1.
const pageProvenances = (page: PageEntity): Provenance[] => {
  const provenances: Provenance[] = [page.provenance];
  const collectBlock = (block: BlockEntity) => {
    provenances.push(block.provenance);
    for (const claim of block.claims) {
      if (claim.provenance !== undefined) {
        provenances.push(claim.provenance);
      }
    }
  };
  for (const block of page.preamble) {
    collectBlock(block);
  }
  for (const section of page.sections) {
    for (const block of section.blocks) {
      collectBlock(block);
    }
  }
  return provenances;
};

// Affected when: (a) a provenance source symbol hash is gone from the HEAD codemap (the
// dependency changed or vanished — provenance already records the hashes, so no old codemap is
// needed); (b) an observed-read file's current content hash differs from the recorded one, or the
// file is missing (bias rule: uncertain provenance ⇒ regenerate).
const isShardAffected = async (input: {
  repoRoot: string;
  shard: PageShard;
  headSymbolHashes: ReadonlySet<string>;
}): Promise<boolean> => {
  const provenances = pageProvenances(input.shard.page);
  for (const provenance of provenances) {
    for (const source of provenance.sources) {
      if (!input.headSymbolHashes.has(source.symbol)) {
        return true;
      }
    }
  }
  for (const provenance of provenances) {
    for (const read of provenance.observedReads) {
      const current = await readOptionalFile(join(input.repoRoot, read.file));
      if (current === undefined || contentHash(current) !== read.contentHash) {
        return true;
      }
    }
  }
  return false;
};

const openFlag = (input: {
  kind: Flag['kind'];
  summary: string;
  detail: string;
  runId: string;
  entity?: Flag['entity'];
}): Flag => ({
  id: mintId(idPrefixes.flag),
  kind: input.kind,
  status: 'open',
  summary: input.summary,
  detail: input.detail,
  ...(input.entity === undefined ? {} : { entity: input.entity }),
  runId: input.runId,
  createdAt: new Date().toISOString()
});

export const runRefresh = async (options: RefreshOptions): Promise<RefreshSummary> => {
  const { repoRoot } = options;
  const family = await loadConfigFamily(repoRoot);
  const { config, ia, glossary } = family;
  const locale = config.locales.source;
  const version = config.versions.current;

  const host = createPluginHost();
  await registerBuiltinPlugins(host);
  await loadConfiguredPlugins(host, config, repoRoot);
  const contextFiles = await loadContextFiles(repoRoot);

  const journal = await createRunJournal(repoRoot, options.runId ?? mintId(idPrefixes.run));
  const commit = await resolveCommit(repoRoot);
  await journal.append({ type: 'run-started', mode: 'refresh', commit });

  await journal.append({ type: 'stage-started', stage: 'codemap' });
  const codemapStarted = Date.now();
  const codemap = await buildCodemap({
    repoRoot,
    commit,
    packs: host.languagePacks().map((entry) => entry.definition)
  });
  await journal.append({
    type: 'stage-completed',
    stage: 'codemap',
    inputHash: hashValue({ commit }),
    durationMs: Date.now() - codemapStarted
  });

  const store = createManifestStore(repoRoot, version);
  const previousIndex = await store.readIndex();
  if (previousIndex === undefined) {
    throw new CoreError(
      'state-corrupt',
      'no committed manifest found — run `docstube generate` before `docstube refresh`',
      { repoRoot, version }
    );
  }

  // Tribal-knowledge lifecycle (same as generate): persist answered flags, then load answers and
  // open-question keys for ask-once dedup during regeneration.
  const refreshPageIds = previousIndex.pages.map((entry) => entry.id);
  const refreshLocales = [locale, ...config.locales.targets];
  await applyFlagAnswers({ repoRoot, store, locales: refreshLocales, pageIds: refreshPageIds });
  const knowledge = await loadKnowledge(repoRoot);
  const openQuestionKeys = await collectOpenQuestionKeys({
    store,
    locales: refreshLocales,
    pageIds: refreshPageIds
  });

  const headSymbolHashes = new Set(codemap.symbols.map((symbol) => symbol.hash));
  const nodesBySlug = new Map(
    walkIaNodes(ia.tree)
      .filter((node) => node.brief !== undefined)
      .map((node) => [node.slug, node])
  );

  const ctx: PageRunContext = {
    repoRoot,
    host,
    codemap,
    journal,
    options: {
      runTask: options.runTask,
      toolDescriptors: options.toolDescriptors,
      maxAttemptsPerPage: options.maxAttemptsPerPage
    },
    config,
    glossary,
    criteria: contextFiles.criteria,
    instructions: contextFiles.instructions,
    knowledge,
    openQuestionKeys,
    commit,
    locale,
    version
  };

  await journal.append({ type: 'stage-started', stage: 'maintain' });
  const maintainStarted = Date.now();
  const regenerated: string[] = [];
  const artifacts: PageArtifact[] = [];
  const indexEntries: ManifestIndex['pages'] = [];
  const newSystemFlags: Flag[] = [];
  let unchangedCount = 0;
  let anyPageFlagged = false;

  for (const entry of previousIndex.pages) {
    const shard = await store.readPageShard({ locale, pageId: entry.id });
    const mdx = await readOptionalFile(join(repoRoot, config.outDir, entry.path));
    const node = nodesBySlug.get(entry.slug);

    if (node === undefined) {
      // The IA node vanished (or lost its brief): a structural change. Never delete on refresh —
      // humans decide structure. Flag it and keep shipping the existing page untouched.
      const flag = openFlag({
        kind: 'structural-change',
        summary: `page "${entry.slug}" is no longer in ia.yml`,
        detail:
          `the generated page "${entry.slug}" has no matching IA node with a brief — refresh kept it as-is. ` +
          'Remove it from the manifest or restore the node in ia.yml to resolve.',
        runId: journal.runId,
        entity: { version, locale, pageId: entry.id }
      });
      newSystemFlags.push(flag);
      await journal.append({ type: 'flag-raised', flag });
      if (shard !== undefined && mdx !== undefined) {
        artifacts.push({ page: shard.page, mdx, mdxPath: entry.path, locale, version });
      }
      indexEntries.push(entry);
      continue;
    }

    const affected =
      shard === undefined || mdx === undefined || (await isShardAffected({ repoRoot, shard, headSymbolHashes }));
    if (!affected && shard !== undefined && mdx !== undefined) {
      // Unaffected: reconstruct the artifact from disk — no agent calls.
      unchangedCount += 1;
      artifacts.push({ page: shard.page, mdx, mdxPath: entry.path, locale, version });
      indexEntries.push(entry);
      continue;
    }

    const { outcome, artifact, shard: newShard } = await generatePage(ctx, node, shard);
    regenerated.push(node.slug);
    artifacts.push(artifact);
    anyPageFlagged = anyPageFlagged || outcome.status === 'flagged';

    const mdxTarget = join(repoRoot, config.outDir, artifact.mdxPath);
    await mkdir(dirname(mdxTarget), { recursive: true });
    await writeFile(mdxTarget, artifact.mdx, 'utf8');
    await store.writePageShard(newShard);
    for (const flag of newShard.flags) {
      await journal.append({ type: 'flag-raised', flag });
    }
    await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });
    indexEntries.push({
      id: artifact.page.id,
      slug: artifact.page.slug,
      title: artifact.page.title,
      path: artifact.mdxPath
    });
  }
  await journal.append({
    type: 'stage-completed',
    stage: 'maintain',
    inputHash: hashValue({ commit, regenerated }),
    durationMs: Date.now() - maintainStarted
  });

  // IA nodes without a generated page are not refresh's job (generate owns new pages) — surface
  // them instead of silently skipping.
  const indexedSlugs = new Set(previousIndex.pages.map((entry) => entry.slug));
  const newNodeWarnings = [...nodesBySlug.keys()]
    .filter((slug) => !indexedSlugs.has(slug))
    .map((slug) => `IA node "${slug}" has no generated page yet — run \`docstube generate\` to create it`);

  // Topology pass: site-scope verifiers over ALL pages (regenerated + reconstructed) restore
  // cross-page consistency after partial regeneration.
  await journal.append({ type: 'stage-started', stage: 'verify' });
  const siteResults = await runVerifiers({
    repoRoot,
    config,
    codemap,
    glossary,
    host,
    artifacts,
    includeSiteScope: true
  });
  const siteFindings = errorFindings(siteResults);
  if (siteFindings.length > 0) {
    await journal.append({ type: 'findings', findings: siteFindings });
  }
  await journal.append({
    type: 'stage-completed',
    stage: 'verify',
    inputHash: hashValue(artifacts.map((artifact) => artifact.page.id)),
    durationMs: 0
  });

  // Coverage is doc-type-conditional: on for libraries/SDKs, off for apps/services.
  const coverageEnabled =
    config.coverage === 'on' || (config.coverage === 'auto' && config.docType === 'external-library');
  let coverageStats: ManifestIndex['coverage'];
  if (coverageEnabled) {
    const documentedHashes = new Set(
      artifacts
        .flatMap((artifact) => pageProvenances(artifact.page))
        .flatMap((provenance) => provenance.sources.map((source) => source.symbol))
    );
    const publicSymbols = codemap.symbols.filter((symbol) => symbol.visibility === 'public');
    const undocumented = publicSymbols.filter((symbol) => !documentedHashes.has(symbol.hash));
    coverageStats = {
      publicSymbols: publicSymbols.length,
      documentedSymbols: publicSymbols.length - undocumented.length
    };
    if (undocumented.length > 0) {
      const samples = undocumented.slice(0, 5).map((symbol) => symbol.name);
      const flag = openFlag({
        kind: 'coverage',
        summary: `${undocumented.length} public symbol(s) are not covered by any documented page`,
        detail: `undocumented public symbols include: ${samples.join(', ')}`,
        runId: journal.runId
      });
      newSystemFlags.push(flag);
      await journal.append({ type: 'flag-raised', flag });
    }
  }

  const index: ManifestIndex = {
    schemaVersion: 1,
    docstubeVersion,
    sourceLocale: locale,
    locales: [locale, ...config.locales.targets],
    versions: [
      { label: version, status: 'current', commit },
      ...config.versions.frozen.map((label) => ({ label, status: 'frozen' as const }))
    ],
    pages: indexEntries,
    configHash: hashValue(family.raw.config),
    iaHash: hashValue(family.raw.ia),
    ...(coverageStats === undefined ? {} : { coverage: coverageStats }),
    systemFlags: [...previousIndex.systemFlags, ...newSystemFlags]
  };
  await store.writeIndex(index);

  const flagged = anyPageFlagged || siteFindings.length > 0 || newSystemFlags.length > 0;
  await journal.append({ type: 'run-completed', outcome: flagged ? 'flagged' : 'passed' });
  return {
    runId: journal.runId,
    outcome: flagged ? 'flagged' : 'passed',
    regenerated,
    unchangedCount,
    siteFindings,
    warnings: [...host.warnings(), ...newNodeWarnings]
  };
};
