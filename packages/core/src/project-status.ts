import type { Manifest } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations.ts';
import { readManifestFile, resolveDirtyPages } from './incremental-engine.ts';
import type { DirtyPageDecision } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { deriveRunId, schedulePagesFromIa } from './pipeline-run.ts';
import { rankRefinementCandidates } from './project-refinement.ts';
import type { RefinementCandidate } from './project-refinement.ts';
import {
  collectProjectSourceFiles,
  createCurrentSeedHashes,
  defaultConfigPath,
  loadProjectConfigFamily,
  normalizeRelativePath,
  pathExists,
  projectDbPath,
  projectManifestPath,
  resolveWorkspacePath,
  withOutputPaths
} from './project-workspace.ts';
import type { PageDetail, RunRecord } from './state-backend.ts';

export type ProjectStatusOptions = {
  configPath?: string;
  dbPath?: string;
  workspaceDir: string;
};

export type ProjectStatusCounts = Record<string, number>;

export type ProjectConfigStatus = {
  error?: string;
  found: boolean;
  path: string;
  valid: boolean;
};

export type ProjectManifestStatus = {
  generatedWith?: string;
  pageCount: number;
  path: string;
  statusCounts: ProjectStatusCounts;
};

export type ProjectStateStatus = {
  found: boolean;
  pageCount: number;
  run?: RunRecord;
};

export type ProjectStatusResult = {
  config: ProjectConfigStatus;
  manifest?: ProjectManifestStatus;
  pageState: ProjectStateStatus;
  refinementCandidates: RefinementCandidate[];
  sourceFilesCount: number;
  staleDecisions: DirtyPageDecision[];
};

const countBy = (values: readonly string[]): ProjectStatusCounts => {
  const counts: ProjectStatusCounts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};

const manifestStatus = (manifest: Manifest, path: string): ProjectManifestStatus => ({
  path,
  pageCount: manifest.pages.length,
  statusCounts: countBy(manifest.pages.map((page) => page.status)),
  generatedWith: `${manifest.generatedWith.name} ${manifest.generatedWith.version}`
});

const loadPageState = async (input: {
  configFamily?: Awaited<ReturnType<typeof loadProjectConfigFamily>>;
  dbPath: string;
}): Promise<{ pages: PageDetail[]; state: ProjectStateStatus }> => {
  if (!(await pathExists(input.dbPath))) {
    return { pages: [], state: { found: false, pageCount: 0 } };
  }

  const backend = createLocalBackend(openDocstubeDatabase(input.dbPath));
  try {
    const runId = input.configFamily ? deriveRunId(input.configFamily.config, input.configFamily.ia) : undefined;
    const summaries = await backend.listPages(runId);
    const pages = await Promise.all(summaries.map((page) => backend.getPage(page.id))).then((details) =>
      details.filter((detail): detail is PageDetail => detail !== null)
    );
    const run = runId ? await backend.getRun(runId) : undefined;
    return {
      pages,
      state: {
        found: true,
        pageCount: pages.length,
        run: run ?? undefined
      }
    };
  } finally {
    await backend.close();
  }
};

export const getProjectStatus = async (input: ProjectStatusOptions): Promise<ProjectStatusResult> => {
  const configPath = input.configPath ?? defaultConfigPath;
  const configAbsolutePath = resolveWorkspacePath(input.workspaceDir, normalizeRelativePath(configPath));
  const dbPath = input.dbPath ?? projectDbPath(input.workspaceDir);
  const manifestPath = projectManifestPath(input.workspaceDir);
  const hasConfig = await pathExists(configAbsolutePath);
  const hasManifest = await pathExists(manifestPath);
  let configFamily: Awaited<ReturnType<typeof loadProjectConfigFamily>> | undefined;
  let configError: string | undefined;

  if (hasConfig) {
    try {
      configFamily = await loadProjectConfigFamily(input.workspaceDir, configPath);
    } catch (error) {
      configError = error instanceof Error ? error.message : 'config validation failed';
    }
  }

  const manifest = hasManifest ? await readManifestFile(manifestPath) : undefined;
  const pageState = await loadPageState({ dbPath, configFamily });
  let sourceFilesCount = 0;
  let staleDecisions: DirtyPageDecision[] = [];

  if (configFamily && manifest) {
    const sourceFiles = await collectProjectSourceFiles({
      workspaceDir: input.workspaceDir,
      config: configFamily.config
    });
    const pages = withOutputPaths(configFamily.config, schedulePagesFromIa(configFamily.ia));
    sourceFilesCount = sourceFiles.length;
    staleDecisions = resolveDirtyPages({
      manifest,
      candidatePageIds: pages.map((page) => page.id),
      currentSeedHashes: createCurrentSeedHashes({
        config: configFamily.config,
        pages,
        sources: sourceFiles
      })
    }).decisions.filter((decision) => decision.action !== 'skip');
  }

  return {
    config: {
      path: configPath,
      found: hasConfig,
      valid: configFamily !== undefined,
      error: configError
    },
    manifest: manifest ? manifestStatus(manifest, manifestPath) : undefined,
    pageState: pageState.state,
    refinementCandidates: manifest ? rankRefinementCandidates({ manifest, pages: pageState.pages }) : [],
    sourceFilesCount,
    staleDecisions
  };
};
