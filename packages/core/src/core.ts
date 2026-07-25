// Public API of @docstube/core — the kernel: config, plugin host, entity extraction/matching,
// state (manifest + run journal), and the pipeline orchestrator.

export { docstubeVersion } from './version.ts';

export { CoreError, configError, pluginLoadError } from './errors.ts';
export type { CoreErrorCode } from './errors.ts';

export {
  configFileNames,
  parseDocstubeConfig,
  parseIaFile,
  parseGlossaryFile,
  loadConfigFamily,
  editYamlDocument,
  setYamlIn,
  editConfigFile
} from './config/config-io.ts';
export type { ConfigFamily, YamlPath } from './config/config-io.ts';

export { createPluginHost } from './plugins/plugin-host.ts';
export type { PluginHost, PluginSource, RegisteredPlugin } from './plugins/plugin-host.ts';
export { registerBuiltinPlugins, loadConfiguredPlugins } from './plugins/load-plugins.ts';

export { detectProject } from './detect/detect-project.ts';
export type { ProjectDetection } from './detect/detect-project.ts';
export { suggestPersonas } from './detect/personas.ts';

export { createBlockRegistry } from './entities/block-registry.ts';
export { extractPageEntity, parseMdx, slugifyAnchor } from './entities/extract-entities.ts';
export type { ExtractPageInput } from './entities/extract-entities.ts';
export { matchEntityIds } from './entities/match-entities.ts';
export type { MatchedPage } from './entities/match-entities.ts';

export { createManifestStore } from './state/manifest-store.ts';
export type { ManifestStore } from './state/manifest-store.ts';
export { createRunJournal, summarizeRun, runsDir } from './state/run-journal.ts';
export type { RunJournal, RunStatusSummary } from './state/run-journal.ts';
export { cutVersionSnapshot } from './state/version-cut.ts';
export type { VersionCutResult } from './state/version-cut.ts';

export { runVerifiers, errorFindings } from './pipeline/verify-page.ts';
export type { VerifyStageInput } from './pipeline/verify-page.ts';
export { configElementPolicy } from './pipeline/element-policy.ts';
export { buildWriterSystemPrompt, buildWriterUserPrompt, buildWritePageTask } from './pipeline/write-page.ts';
export type { WritePromptInput } from './pipeline/write-page.ts';
export { runGenerate, unwrapMdxFence, resolveCommit } from './pipeline/generate.ts';
export type { GenerateOptions, GenerateSummary } from './pipeline/generate.ts';
export { generatePage, contentRelativePath } from './pipeline/page-runner.ts';
export type { PageOutcome, PageRunContext, PageRunOptions, TaskRunner } from './pipeline/page-runner.ts';
export { reviewPage, buildReviewPageTask, defaultReviewCriteria } from './pipeline/review-page.ts';
export type { ReviewPageInput } from './pipeline/review-page.ts';
export { loadContextFiles } from './pipeline/context-files.ts';
export type { ContextFiles } from './pipeline/context-files.ts';
export {
  applyFlagAnswers,
  collectOpenQuestions,
  flagQuestionDescriptor,
  loadKnowledge,
  questionKey,
  writeKnowledgeAnswer
} from './pipeline/tribal-knowledge.ts';
export type { CapturedQuestion, KnowledgeEntry } from './pipeline/tribal-knowledge.ts';
export { anchorWriterLedger } from './pipeline/anchor-ledger.ts';
export type {
  AnchoredClaim,
  AnchorIssue,
  AnchorIssueCode,
  AnchorLedgerInput,
  AnchorLedgerResult,
  RejectedProposal
} from './pipeline/anchor-ledger.ts';
export { lintUncoveredAssertions, coverageLintHint, coverageLintRules } from './pipeline/coverage-lint.ts';
export type { CoverageLintInput } from './pipeline/coverage-lint.ts';
export { matchClaimIds } from './pipeline/match-claims.ts';
export type { ClaimMatch, ClaimMatchConfidence, MatchClaimIdsInput, MatchedClaimIds } from './pipeline/match-claims.ts';
export { translateArtifact, buildTranslatePageTask, alignTranslatedEntities } from './pipeline/translate-page.ts';
export type { TranslationOutcome } from './pipeline/translate-page.ts';
export { runMaintain } from './pipeline/maintain.ts';
export type { MaintainOptions, MaintainSummary } from './pipeline/maintain.ts';
export { runRefine, rankPagesForRefinement } from './pipeline/refine.ts';
export type { RefineOptions, RefineSummary, RefinedPage } from './pipeline/refine.ts';
export { runAudit, auditFallbackConfig } from './audit/run-audit.ts';
export type { AuditReport, AuditDefect, RunAuditOptions } from './audit/run-audit.ts';
export { createRunCostTracker, FREEZE_MARGIN_RATIO } from './pipeline/run-cost.ts';
export type { RunCostTracker } from './pipeline/run-cost.ts';
export {
  buildProposeIaTask,
  proposalsFromTranscript,
  iaProposalsResultSchema,
  iaProposalIds
} from './pipeline/propose-ia.ts';
export type { IaProposal, IaProposalsResult, ProposeIaInput } from './pipeline/propose-ia.ts';
export {
  buildExtractThemeTokensTask,
  tokensFromTranscript,
  themeTokenNames,
  themeTokenExtractionSchema
} from './pipeline/extract-theme-tokens.ts';
export type { ThemeTokenName, ThemeTokensResult } from './pipeline/extract-theme-tokens.ts';
export { updateConfigValues, writeIaFile, scaffoldConfigFamily } from './config/write-config.ts';
export type { ConfigValueUpdate, ConfigFamilySeed, ScaffoldResult } from './config/write-config.ts';
export {
  appendFeedbackEntry,
  buildCategorizeFeedbackTask,
  categorizationFromTranscript,
  feedbackCategories
} from './server/feedback.ts';
export type { FeedbackCategory } from './server/feedback.ts';
export { createTransportFromConfig, createTaskRunnerFromConfig } from './pipeline/task-runner.ts';
export type { ConfiguredTaskRunner } from './pipeline/task-runner.ts';

export { createLocalApp, startLocalServer } from './server/local-server.ts';
export type { LocalAppOptions, LocalServer, LocalServerOptions } from './server/local-server.ts';
export { controlPlaneRouter, createControlPlaneCaller } from './server/trpc-router.ts';
export type {
  ControlPlaneContext,
  ControlPlaneRouter,
  FlagQueueEntry,
  RunListEntry,
  ControlPlaneInjection,
  RunMode
} from './server/trpc-router.ts';
