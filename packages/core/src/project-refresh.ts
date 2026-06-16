import { readFile } from 'node:fs/promises';
import { findingSchema } from '@docstube/contracts';
import type { Finding, Manifest, ManifestPage, PageId, RelativePath, Timestamp } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations.ts';
import {
  readManifestFile,
  resolveDirtyPages,
  runTopologyConsistencyPass,
  updateManifest,
  writeManifestFile
} from './incremental-engine.ts';
import type { DirtyPageDecision, ManifestPageUpdate, TopologyPage } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { refreshGeneratedSiteAssets } from './project-assets.ts';
import type { ProjectAssetRefreshResult } from './project-assets.ts';
import { generateConfiguredProjectPages } from './project-generation.ts';
import type { ProjectGenerationAdapterFactory } from './project-generation.ts';
import { initializeRunFromConfigFamily, transitionRunStatus } from './pipeline-run.ts';
import {
  collectProjectSourceFiles,
  createCurrentSeedHashes,
  defaultConfigPath,
  ensureDocstubeDir,
  outputPagesDir,
  pathExists,
  projectDbPath,
  projectManifestPath,
  resolveWorkspacePath,
  withOutputPaths
} from './project-workspace.ts';
import type { StateBackend } from './state-backend.ts';

export type ProjectRefreshOptions = {
  adapterFactory?: ProjectGenerationAdapterFactory;
  configPath?: string;
  dbPath?: string;
  now?: () => Timestamp;
  workspaceDir: string;
};

export type ProjectRefreshPageChange = {
  action: 'flagged' | 'regenerated';
  findings: Finding[];
  id: PageId;
  path?: RelativePath;
  reasons: string[];
};

export type ProjectRefreshResult = {
  assetRefresh: ProjectAssetRefreshResult;
  changedPages: ProjectRefreshPageChange[];
  manifest: Manifest;
  manifestPath: string;
  runId: string;
  skippedPageIds: string[];
  sourceFilesCount: number;
  topologyFindings: Finding[];
};

const docstubeVersion = '0.0.2';
const defaultTimestamp: Timestamp = '2026-06-16T00:00:00.000Z';

const findingsForPage = (findings: readonly Finding[], pageId: string): Finding[] =>
  findings.filter((finding) => finding.pageId === pageId);

const missingGeneratedPageFinding = (page: ManifestPage): Finding =>
  findingSchema.parse({
    code: 'generated-page-missing',
    severity: 'major',
    origin: 'verifier',
    message: `Generated page file is missing: ${page.path}`,
    pageId: page.id,
    location: { path: page.path }
  });

const manifestUpdateFromPage = (page: ManifestPage, status: ManifestPage['status']): ManifestPageUpdate => ({
  id: page.id,
  path: page.path,
  title: page.title,
  status,
  sections: page.sections,
  provenance: page.provenance
});

const changedDecisionReasons = (decision: DirtyPageDecision | undefined, fallback: string): string[] =>
  decision && decision.reasons.length > 0 ? decision.reasons : [fallback];

const topologyPagesFromManifest = async (
  workspaceDir: string,
  manifest: Manifest
): Promise<{ findings: Finding[]; pages: TopologyPage[] }> => {
  const entries = await Promise.all(
    manifest.pages.map(async (page): Promise<{ finding?: Finding; page?: TopologyPage }> => {
      const absolutePath = resolveWorkspacePath(workspaceDir, page.path);
      if (!(await pathExists(absolutePath))) {
        return { finding: missingGeneratedPageFinding(page) };
      }

      return {
        page: {
          id: page.id,
          path: page.path,
          content: await readFile(absolutePath, 'utf8')
        }
      };
    })
  );

  return {
    pages: entries.flatMap((entry) => (entry.page ? [entry.page] : [])),
    findings: entries.flatMap((entry) => (entry.finding ? [entry.finding] : []))
  };
};

const upsertFlaggedPage = async (input: {
  backend: StateBackend;
  findings: readonly Finding[];
  manifestPage: ManifestPage;
  runId: string;
  timestamp: Timestamp;
}): Promise<void> => {
  await input.backend.upsertPage({
    id: input.manifestPage.id,
    runId: input.runId,
    title: input.manifestPage.title ?? input.manifestPage.id,
    slug: input.manifestPage.path,
    status: 'flagged',
    approved: false,
    findings: [...input.findings],
    updatedAt: input.timestamp
  });
};

export const refreshProjectDocumentation = async (input: ProjectRefreshOptions): Promise<ProjectRefreshResult> => {
  const dbPath = input.dbPath ?? projectDbPath(input.workspaceDir);
  const manifestPath = projectManifestPath(input.workspaceDir);
  const now = input.now ?? (() => defaultTimestamp);

  await ensureDocstubeDir(input.workspaceDir);
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const initialized = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath ?? defaultConfigPath,
      workspaceDir: input.workspaceDir,
      now
    });
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'running', now });

    const manifest = await readManifestFile(manifestPath);
    const sourceFiles = await collectProjectSourceFiles({
      workspaceDir: input.workspaceDir,
      config: initialized.config
    });
    const scheduledPages = withOutputPaths(initialized.config, initialized.scheduledPages);
    const manifestById = new Map(manifest.pages.map((page) => [page.id, page]));
    const dirty = resolveDirtyPages({
      manifest,
      candidatePageIds: scheduledPages.map((page) => page.id),
      currentSeedHashes: createCurrentSeedHashes({
        config: initialized.config,
        pages: scheduledPages,
        sources: sourceFiles
      })
    });
    const decisionsByPageId = new Map(dirty.decisions.map((decision) => [decision.pageId, decision]));
    const missingPages = scheduledPages.filter((page) => !manifestById.has(page.id));
    const pagesToGenerate = [
      ...scheduledPages.filter((page) => decisionsByPageId.get(page.id)?.action === 'regenerate'),
      ...missingPages
    ];
    const uniquePagesToGenerate = [...new Map(pagesToGenerate.map((page) => [page.id, page])).values()].toSorted(
      (left, right) => left.order - right.order
    );
    const timestamp = now();
    const generation =
      uniquePagesToGenerate.length > 0
        ? await generateConfiguredProjectPages({
            adapterFactory: input.adapterFactory,
            backend,
            config: initialized.config,
            generatedAt: timestamp,
            pages: uniquePagesToGenerate,
            runId: initialized.run.id,
            sourceFiles,
            workspaceDir: input.workspaceDir
          })
        : { generatedPages: [], manifestPages: [] };
    const flagUpdates: ManifestPageUpdate[] = [];
    const changedPages = new Map<string, ProjectRefreshPageChange>();
    const flagTasks: Promise<void>[] = [];

    for (const decision of dirty.decisions) {
      if (decision.action === 'skip') {
        continue;
      }

      const manifestPage = manifestById.get(decision.pageId);
      if (!manifestPage) {
        continue;
      }

      const pageFindings = findingsForPage(dirty.findings, decision.pageId);
      if (decision.action === 'flag') {
        flagUpdates.push(manifestUpdateFromPage(manifestPage, 'flagged'));
        flagTasks.push(
          upsertFlaggedPage({
            backend,
            findings: pageFindings,
            manifestPage,
            runId: initialized.run.id,
            timestamp
          })
        );
      }

      changedPages.set(decision.pageId, {
        id: manifestPage.id,
        path: manifestPage.path,
        action: decision.action === 'regenerate' ? 'regenerated' : 'flagged',
        reasons: changedDecisionReasons(decision, 'stale'),
        findings: pageFindings
      });
    }
    await Promise.all(flagTasks);

    for (const page of missingPages) {
      changedPages.set(page.id, {
        id: page.id,
        path: page.slug,
        action: 'regenerated',
        reasons: ['nav-page-missing'],
        findings: []
      });
    }

    for (const page of generation.generatedPages) {
      const existing = changedPages.get(page.id);
      changedPages.set(page.id, {
        id: page.id,
        path: page.path,
        action: 'regenerated',
        reasons: existing?.reasons ?? ['stale'],
        findings: page.findings
      });
    }

    const preliminaryManifest = updateManifest({
      existing: manifest,
      generatedWith: { name: 'docstube', version: docstubeVersion },
      pages: [...generation.manifestPages, ...flagUpdates]
    });
    const topologyInput = await topologyPagesFromManifest(input.workspaceDir, preliminaryManifest);
    const topologyFindings = [
      ...topologyInput.findings,
      ...runTopologyConsistencyPass({
        ia: initialized.ia,
        glossary: initialized.glossary,
        manifest: preliminaryManifest,
        outputDir: outputPagesDir(initialized.config.output.dir),
        pages: topologyInput.pages,
        regeneratedPageIds: generation.generatedPages.map((page) => page.id)
      })
    ];
    const topologyPageIds = new Set(
      topologyFindings.map((finding) => finding.pageId).filter((pageId): pageId is PageId => pageId !== undefined)
    );
    const finalStatusUpdates: ManifestPageUpdate[] = [];
    const topologyFlagTasks: Promise<void>[] = [];

    for (const pageId of topologyPageIds) {
      const page = preliminaryManifest.pages.find((candidate) => candidate.id === pageId);
      if (!page) {
        continue;
      }
      const pageFindings = findingsForPage(topologyFindings, page.id);
      finalStatusUpdates.push(manifestUpdateFromPage(page, 'flagged'));
      topologyFlagTasks.push(
        upsertFlaggedPage({
          backend,
          findings: pageFindings,
          manifestPage: page,
          runId: initialized.run.id,
          timestamp
        })
      );
      changedPages.set(page.id, {
        id: page.id,
        path: page.path,
        action: 'flagged',
        reasons: [...(changedPages.get(page.id)?.reasons ?? []), 'topology-findings'],
        findings: pageFindings
      });
    }
    await Promise.all(topologyFlagTasks);

    const finalManifest = updateManifest({
      existing: preliminaryManifest,
      generatedWith: { name: 'docstube', version: docstubeVersion },
      pages: finalStatusUpdates
    });
    await writeManifestFile(manifestPath, finalManifest);
    const assetRefresh = await refreshGeneratedSiteAssets({
      config: initialized.config,
      glossary: initialized.glossary,
      ia: initialized.ia,
      workspaceDir: input.workspaceDir
    });
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'completed', now });

    return {
      assetRefresh,
      changedPages: [...changedPages.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
      manifest: finalManifest,
      manifestPath,
      runId: initialized.run.id,
      skippedPageIds: dirty.skippedPageIds,
      sourceFilesCount: sourceFiles.length,
      topologyFindings
    };
  } finally {
    await backend.close();
  }
};
