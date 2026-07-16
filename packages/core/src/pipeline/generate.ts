import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { PageArtifact } from '@docstube/plugin-sdk';
import type { Finding, IaNode, ManifestIndex } from '@docstube/contracts';
import { hashValue, idPrefixes, mintId, walkIaNodes } from '@docstube/contracts';
import { buildCodemap } from '@docstube/codemap';
import { loadConfigFamily } from '../config/config-io.ts';
import { docstubeVersion } from '../version.ts';
import { createPluginHost } from '../plugins/plugin-host.ts';
import { loadConfiguredPlugins, registerBuiltinPlugins } from '../plugins/load-plugins.ts';
import { createManifestStore } from '../state/manifest-store.ts';
import { createRunJournal } from '../state/run-journal.ts';
import { errorFindings, runVerifiers } from './verify-page.ts';
import { loadContextFiles } from './context-files.ts';
import { applyFlagAnswers, collectOpenQuestionKeys, loadKnowledge } from './tribal-knowledge.ts';
import { generatePage } from './page-runner.ts';
import type { PageOutcome, PageRunContext, TaskRunner } from './page-runner.ts';
import { translateArtifact } from './translate-page.ts';
import type { TranslationOutcome } from './translate-page.ts';
import { createRunCostTracker, freezeReason } from './run-cost.ts';
import type { ToolDescriptor } from '@docstube/contracts';

const execFileAsync = promisify(execFile);

// The generate pipeline (PRODUCT §3.5): codemap → per-page (context → write ⇄ review∥verify →
// gate) → assemble. Pages stream out as they land ("the waiting room is the review room"); every
// step is journaled; agent work goes through the injected TaskRunner so core stays
// transport-agnostic. The per-page loop lives in page-runner.ts (shared with maintain/refresh).

export type { PageOutcome, TaskRunner } from './page-runner.ts';
export { unwrapMdxFence, contentRelativePath } from './page-runner.ts';

export type GenerateOptions = {
  repoRoot: string;
  runTask: TaskRunner;
  toolDescriptors: ToolDescriptor[];
  runId?: string | undefined;
  maxAttemptsPerPage?: number | undefined;
};

export type GenerateSummary = {
  runId: string;
  outcome: 'passed' | 'flagged' | 'frozen' | 'failed';
  pages: PageOutcome[];
  translations: TranslationOutcome[];
  siteFindings: Finding[];
  warnings: string[];
  // Total task cost reported this run; present whenever any task carried a costUsd.
  spentUsd?: number;
};

export const resolveCommit = async (repoRoot: string): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return '0'.repeat(40);
  }
};

const pageNodes = (nodes: IaNode[]): IaNode[] => walkIaNodes(nodes).filter((node) => node.brief !== undefined);

export const runGenerate = async (options: GenerateOptions): Promise<GenerateSummary> => {
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
  await journal.append({ type: 'run-started', mode: 'generate', commit });

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
  const slugToPageId = new Map((previousIndex?.pages ?? []).map((entry) => [entry.slug, entry.id]));

  // Tribal-knowledge lifecycle: persist any human-answered flags into the knowledge store, then
  // load answers (writer context) and open-question keys (ask-once dedup) for this run.
  const previousPageIds = (previousIndex?.pages ?? []).map((entry) => entry.id);
  const allLocales = [locale, ...config.locales.targets];
  await applyFlagAnswers({ repoRoot, store, locales: allLocales, pageIds: previousPageIds });
  const knowledge = await loadKnowledge(repoRoot);
  const openQuestionKeys = await collectOpenQuestionKeys({ store, locales: allLocales, pageIds: previousPageIds });

  const maxRunUsd = config.agents.budgets.maxRunUsd;
  const costTracker = createRunCostTracker(maxRunUsd);

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
    costTracker,
    commit,
    locale,
    version
  };
  const outcomes: PageOutcome[] = [];
  const translations: TranslationOutcome[] = [];
  const artifacts: PageArtifact[] = [];

  let openFlagsRaised = 0;
  const persistArtifact = async (artifact: PageArtifact, shard: Parameters<typeof store.writePageShard>[0]) => {
    const mdxTarget = join(repoRoot, config.outDir, artifact.mdxPath);
    await mkdir(dirname(mdxTarget), { recursive: true });
    await writeFile(mdxTarget, artifact.mdx, 'utf8');
    await store.writePageShard(shard);
    for (const flag of shard.flags) {
      await journal.append({ type: 'flag-raised', flag });
      if (flag.status === 'open') {
        openFlagsRaised += 1;
      }
    }
  };

  // Cap-freeze (PRODUCT §3.5): checked only BETWEEN pages (and before translations) — never
  // mid-page, because a half-verified page would ship state the gate never approved. Pages that
  // already landed stay shipped; remaining pages are simply not generated.
  let frozen = false;
  for (const node of pageNodes(ia.tree)) {
    if (costTracker.shouldFreeze()) {
      frozen = true;
      break;
    }
    const previousPageId = slugToPageId.get(node.slug);
    const previousShard =
      previousPageId === undefined ? undefined : await store.readPageShard({ locale, pageId: previousPageId });
    const { outcome, artifact, shard } = await generatePage(ctx, node, previousShard);
    outcomes.push(outcome);
    artifacts.push(artifact);

    // Assemble per page as it lands: MDX into the site content dir, shard into the manifest.
    await persistArtifact(artifact, shard);
    await journal.append({ type: 'page-status', pageId: outcome.pageId, status: outcome.status });

    // Verified translations stream out right behind their source page (PRODUCT §4.1 i18n).
    if (config.locales.targets.length > 0 && outcome.status === 'passed') {
      if (costTracker.shouldFreeze()) {
        frozen = true;
        break;
      }
      for (const translation of await translateArtifact(ctx, artifact)) {
        translations.push(translation.outcome);
        await persistArtifact(translation.artifact, translation.shard);
      }
    }
  }
  if (frozen && maxRunUsd !== undefined) {
    await journal.append({ type: 'run-frozen', reason: freezeReason(maxRunUsd), spentUsd: costTracker.spentUsd() });
  }

  // Topology / site-scope verification across all pages (cross-page links, orphans).
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

  const index: ManifestIndex = {
    schemaVersion: 1,
    docstubeVersion,
    sourceLocale: locale,
    locales: [locale, ...config.locales.targets],
    versions: [
      { label: version, status: 'current', commit },
      ...config.versions.frozen.map((label) => ({ label, status: 'frozen' as const }))
    ],
    pages: artifacts.map((artifact) => ({
      id: artifact.page.id,
      slug: artifact.page.slug,
      title: artifact.page.title,
      path: artifact.mdxPath
    })),
    configHash: hashValue(family.raw.config),
    iaHash: hashValue(family.raw.ia),
    systemFlags: []
  };
  await store.writeIndex(index);

  const flagged =
    outcomes.some((outcome) => outcome.status === 'flagged') ||
    translations.some((translation) => translation.status === 'flagged') ||
    openFlagsRaised > 0 ||
    siteFindings.length > 0;
  const outcome = frozen ? 'frozen' : flagged ? 'flagged' : 'passed';
  await journal.append({ type: 'run-completed', outcome });
  return {
    runId: journal.runId,
    outcome,
    pages: outcomes,
    translations,
    siteFindings,
    warnings: host.warnings(),
    ...(costTracker.hasReportedCost() ? { spentUsd: costTracker.spentUsd() } : {})
  };
};
