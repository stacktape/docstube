export { editYamlDocument, loadDocstubeConfig, loadGlossary, loadIa, parseYaml, setYamlIn } from './config-yaml';
export type { YamlPath } from './config-yaml';

export { appConfig, feedback, iaProposals, pages, runs, themeTokens } from './db-schema';
export { migrate, migrations, openDocstubeDatabase } from './db-migrations';
export type { Migration, MigrateResult, OpenDatabaseOptions, SqliteDatabase } from './db-migrations';

export { scaffoldDocstubeDir } from './scaffold';
export type { ScaffoldOptions, ScaffoldResult } from './scaffold';

export { pageProgressStatuses, runStatuses, STATE_BACKEND_VERSION, StateBackendError } from './state-backend';
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
} from './state-backend';

export { createLocalBackend } from './local-backend';
export type { LocalBackendOptions } from './local-backend';

export {
  createTerminalProgressState,
  deriveRunId,
  freezeRunForCaps,
  initializeRunFromConfigFamily,
  resumeRunAfterCapIncrease,
  schedulePagesFromIa,
  transitionRunStatus
} from './pipeline-run';
export type {
  RunInitializationOptions,
  RunInitializationResult,
  ScheduledPage,
  TerminalProgressState
} from './pipeline-run';

export {
  createReviewerRunInput,
  createWriterRunInput,
  mergeFindings,
  runReplayPageGeneration
} from './page-orchestrator';
export type {
  PageDeterministicVerifier,
  PageGenerationOptions,
  PageGenerationResult,
  PersonaReviewer
} from './page-orchestrator';

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
} from './pipeline-artifacts';
export type {
  AgentCacheKeyInput,
  CachedAgentRun,
  DiffChangelogEntry,
  RetryAttemptResult,
  RetryLoopResult
} from './pipeline-artifacts';

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
} from './incremental-engine';
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
} from './incremental-engine';

export { createLocalControlPlaneApp, startGenerateSession, startLocalControlPlane } from './local-server';
export type {
  GenerateStartupOptions,
  LocalControlPlaneApp,
  LocalControlPlaneAppOptions,
  OpenBrowser,
  StartedLocalControlPlane,
  StartLocalControlPlaneOptions
} from './local-server';

export { writeSetupWizardFiles } from './setup-files';
export type { SetupWizardFileWriteInput, SetupWizardFileWriteResult } from './setup-files';

export {
  createS0WalkingSkeletonReplayFixture,
  runS0WalkingSkeleton,
  walkingSkeletonHtmlToken,
  walkingSkeletonOutputPath,
  walkingSkeletonRunId,
  walkingSkeletonSourcePath,
  walkingSkeletonTaskId
} from './walking-skeleton';
export type {
  WalkingSkeletonOptions,
  WalkingSkeletonReplayFixtureOptions,
  WalkingSkeletonResult
} from './walking-skeleton';

export { appRouter, appRouterContract, appRouterProcedures } from './trpc-router';
export type { AppRouter, AppRouterProcedure, AppRouterProcedureContract, JsonSchema, TrpcContext } from './trpc-router';

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
