export { editYamlDocument, loadDocstubeConfig, loadGlossary, loadIa, parseYaml, setYamlIn } from './config-yaml.ts';
export type { YamlPath } from './config-yaml.ts';

export { appConfig, feedback, iaProposals, pages, runs, themeTokens } from './db-schema.ts';
export { migrate, migrations, openDocstubeDatabase } from './db-migrations.ts';
export type { Migration, MigrateResult, OpenDatabaseOptions, SqliteDatabase } from './db-migrations.ts';

export { scaffoldDocstubeDir } from './scaffold.ts';
export type { ScaffoldOptions, ScaffoldResult } from './scaffold.ts';

export { pageProgressStatuses, runStatuses, STATE_BACKEND_VERSION, StateBackendError } from './state-backend.ts';
export type {
  IaProposal,
  PageDetail,
  PageProgress,
  PageSummary,
  RunRecord,
  RunStatus,
  StateBackend,
  StateBackendErrorCode,
  ThemeTokens
} from './state-backend.ts';

export { createLocalBackend } from './local-backend.ts';
export type { LocalBackendOptions } from './local-backend.ts';

export {
  createTerminalProgressState,
  deriveRunId,
  freezeRunForCaps,
  initializeRunFromConfigFamily,
  resumeRunAfterCapIncrease,
  schedulePagesFromIa,
  transitionRunStatus
} from './pipeline-run.ts';
export type {
  RunInitializationOptions,
  RunInitializationResult,
  ScheduledPage,
  TerminalProgressState
} from './pipeline-run.ts';

export { initializeProjectGeneration } from './project-generation.ts';
export type {
  ProjectGenerationInitializationOptions,
  ProjectGenerationInitializationResult
} from './project-generation.ts';

export {
  createReviewerRunInput,
  createWriterRunInput,
  mergeFindings,
  runReplayPageGeneration
} from './page-orchestrator.ts';
export type {
  PageDeterministicVerifier,
  PageGenerationOptions,
  PageGenerationResult,
  PersonaReviewer
} from './page-orchestrator.ts';

export {
  createFaqAeoWriterGuidance,
  deriveAgentCacheKey,
  generateChangelogFromDiff,
  readCachedAgentRun,
  redactTranscriptValue,
  runCachedAgentStep,
  runRetryLoop,
  writeAgentTranscript,
  writeCachedAgentRun
} from './pipeline-artifacts.ts';
export type {
  AgentCacheKeyInput,
  CachedAgentRun,
  DiffChangelogEntry,
  RetryAttemptResult,
  RetryLoopResult
} from './pipeline-artifacts.ts';

export {
  createPageProvenance,
  createSourceSnapshot,
  detectChangedSources,
  extractGlossaryReferences,
  extractMarkdownDocLinks,
  hashNormalizedSource,
  hashSeedContext,
  mapChangedSymbolsToPages,
  normalizeSourceForHash,
  readManifestFile,
  resolveDirtyPages,
  runTopologyConsistencyPass,
  updateManifest,
  writeManifestFile
} from './incremental-engine.ts';
export type {
  ChangedSource,
  ChangedSymbolRef,
  CreatePageProvenanceInput,
  DirtyPageAction,
  DirtyPageDecision,
  DirtyPagesResult,
  ManifestPageUpdate,
  ResolveDirtyPagesInput,
  SourceSnapshot,
  SourceSnapshotInput,
  TopologyConsistencyInput,
  TopologyPage,
  UpdateManifestInput
} from './incremental-engine.ts';

export { createLocalControlPlaneApp, startGenerateSession, startLocalControlPlane } from './local-server.ts';
export type {
  GenerateStartupOptions,
  LocalControlPlaneApp,
  LocalControlPlaneAppOptions,
  OpenBrowser,
  StartedLocalControlPlane,
  StartLocalControlPlaneOptions
} from './local-server.ts';

export { writeSetupWizardFiles } from './setup-files.ts';
export type { SetupWizardFileWriteInput, SetupWizardFileWriteResult } from './setup-files.ts';

export {
  createS0WalkingSkeletonReplayFixture,
  runS0WalkingSkeleton,
  walkingSkeletonHtmlToken,
  walkingSkeletonOutputPath,
  walkingSkeletonRunId,
  walkingSkeletonSourcePath,
  walkingSkeletonTaskId
} from './walking-skeleton.ts';
export type {
  WalkingSkeletonOptions,
  WalkingSkeletonReplayFixtureOptions,
  WalkingSkeletonResult
} from './walking-skeleton.ts';

export { appRouter, appRouterContract, appRouterProcedures } from './trpc-router.ts';
export type {
  AppRouter,
  AppRouterProcedure,
  AppRouterProcedureContract,
  JsonSchema,
  TrpcContext
} from './trpc-router.ts';

export type DocstubeWorkspacePackage =
  | '@docstube/agent'
  | '@docstube/codemap'
  | '@docstube/contracts'
  | '@docstube/core'
  | '@docstube/extractors'
  | '@docstube/skills'
  | '@docstube/theme'
  | '@docstube/verifiers';

export type DocstubeWorkspaceApp = '@docstube/action' | '@docstube/web' | '@docstube/web-ui' | 'docstube';

export const docstubeWorkspacePackages: DocstubeWorkspacePackage[] = [
  '@docstube/contracts',
  '@docstube/core',
  '@docstube/agent',
  '@docstube/verifiers',
  '@docstube/codemap',
  '@docstube/extractors',
  '@docstube/theme',
  '@docstube/skills'
];

export const docstubeWorkspaceApps: DocstubeWorkspaceApp[] = [
  'docstube',
  '@docstube/web-ui',
  '@docstube/action',
  '@docstube/web'
];

export const docstubeVersion = '0.0.2';

export const getDocstubePackageInfo = () => {
  return {
    apps: docstubeWorkspaceApps,
    packages: docstubeWorkspacePackages,
    version: docstubeVersion
  };
};
