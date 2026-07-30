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

export {
  clearOnboardingDraft,
  draftIa,
  draftSetupConfig,
  emptyOnboardingDraft,
  onboardingDraftPatchSchema,
  onboardingDraftRelativePath,
  onboardingDraftSchema,
  readOnboardingDraft,
  readSetupStatus,
  resolveSetupConfig,
  saveOnboardingDraft
} from './config/onboarding-draft.ts';
export type {
  DraftAgentSettings,
  OnboardingDraft,
  OnboardingDraftPatch,
  SetupConfigResolution,
  SetupConfigSource,
  SetupStatus
} from './config/onboarding-draft.ts';

export { createPluginHost } from './plugins/plugin-host.ts';
export type { PluginHost, PluginSource, RegisteredPlugin } from './plugins/plugin-host.ts';
export { registerBuiltinPlugins, loadConfiguredPlugins } from './plugins/load-plugins.ts';

export { detectProject } from './detect/detect-project.ts';
export type { ProjectDetection } from './detect/detect-project.ts';
export { suggestPersonas } from './detect/personas.ts';
export { detectProviders, soleViableProvider } from './detect/detect-providers.ts';
export type { ProviderCandidate } from './detect/detect-providers.ts';

export { createBlockRegistry } from './entities/block-registry.ts';
export { extractPageEntity, parseMdx, slugifyAnchor } from './entities/extract-entities.ts';
export type { ExtractPageInput } from './entities/extract-entities.ts';
export { matchEntityIds } from './entities/match-entities.ts';
export type { MatchedPage } from './entities/match-entities.ts';

export { createManifestStore } from './state/manifest-store.ts';
export type { ManifestStore } from './state/manifest-store.ts';
export { createRunJournal, summarizeRun, runsDir } from './state/run-journal.ts';
export type { RunJournal, RunStatusSummary } from './state/run-journal.ts';
export {
  acquireRunLock,
  readRunLock,
  runInProgressError,
  runLockHeartbeatMs,
  runLockPath,
  runLockRecordSchema,
  runLockRelativePath,
  runLockStaleMs,
  runLockStaleness,
  startExclusiveRun,
  withRunLock
} from './state/run-lock.ts';
export type {
  AcquireRunLockResult,
  ExclusiveRunStart,
  HeldRunLock,
  RunLockHandle,
  RunLockRecord,
  RunLockStaleReason
} from './state/run-lock.ts';
export { cutVersionSnapshot } from './state/version-cut.ts';
export type { VersionCutResult } from './state/version-cut.ts';

export { runVerifiers, errorFindings } from './pipeline/verify-page.ts';
export type { VerifyStageInput } from './pipeline/verify-page.ts';
export { configElementPolicy } from './pipeline/element-policy.ts';
export { buildWriterSystemPrompt, buildWriterUserPrompt, buildWritePageTask } from './pipeline/write-page.ts';
export type { WritePromptInput } from './pipeline/write-page.ts';
export { runGenerate, unwrapMdxFence, resolveCommit } from './pipeline/generate.ts';
export type { GenerateOptions, GenerateSummary } from './pipeline/generate.ts';
export {
  discardStaging,
  finishInterruptedPublish,
  openPublishStaging,
  planFingerprint,
  readStagedRun,
  stagingDir,
  stagingRelativeDir
} from './pipeline/publish-staging.ts';
export type { PublishStaging, SitePublisher, StagedPageRecord, StagedRunState } from './pipeline/publish-staging.ts';
export {
  buildPublicationDecision,
  collectOutputInventory,
  compareLedgerSnapshots,
  emitPublicationDecision,
  failedPublicationInputs,
  inventoryBindingHash,
  outputInventoryRelativePath,
  publicationDecisionRelativePath,
  publicationOutputRoots,
  readLedgerSnapshot,
  resolveDeterministicGate,
  snapshotPageLedger
} from './pipeline/publication-decision.ts';
export type {
  BlockingDisposition,
  ClaimSnapshot,
  LedgerSnapshot,
  PageLedgerSnapshot,
  PublicationDecisionInputs,
  PublicationExecution
} from './pipeline/publication-decision.ts';
export { generatePage, contentRelativePath } from './pipeline/page-runner.ts';
export type { PageOutcome, PageRunContext, PageRunOptions, TaskRunner } from './pipeline/page-runner.ts';
export { reviewPage, buildReviewPageTask, defaultReviewCriteria } from './pipeline/review-page.ts';
export type { ReviewPageInput } from './pipeline/review-page.ts';
export { loadContextFiles } from './pipeline/context-files.ts';
export type { ContextFiles } from './pipeline/context-files.ts';
export { createQuestionCollector, flagQuestionDescriptor } from './pipeline/tribal-knowledge.ts';
export {
  activeFactForNeed,
  emptyKnowledgeState,
  factHistoryForNeed,
  knowledgeContextFacts,
  knowledgeDir,
  knowledgeFactFragmentHash,
  loadKnowledgeState,
  writeKnowledgeFact,
  writeKnowledgeNeed
} from './knowledge/knowledge-store.ts';
export type { KnowledgeContextFact, KnowledgeState } from './knowledge/knowledge-store.ts';
export {
  answerKnowledgeNeed,
  applyFlagAnswers,
  knowledgeDirtyPages,
  mergeKnowledgeNeed,
  reconcileKnowledgePropagation
} from './knowledge/knowledge-answers.ts';
export type { AppliedAnswer, ApplyFlagAnswersResult } from './knowledge/knowledge-answers.ts';
export {
  buildKnowledgeSubject,
  normalizeMissingFact,
  questionsSimilar,
  resolveSlot,
  resolveSubjectSymbol,
  slotKey,
  subjectKey,
  suggestedNeedMerges
} from './knowledge/knowledge-slots.ts';
export type { MergeSuggestion, MissingFactSlot } from './knowledge/knowledge-slots.ts';
export { currentSubjectFingerprint, revalidateKnowledge } from './knowledge/knowledge-revalidation.ts';
export { createKnowledgeSession } from './knowledge/knowledge-session.ts';
export type { CapturedQuestion, KnowledgeSession } from './knowledge/knowledge-session.ts';
export { openKnowledgeForRun } from './knowledge/knowledge-lifecycle.ts';
export { createFingerprintResolver, resolveAnswerAuthor } from './knowledge/answer-fingerprints.ts';
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
export { runRefine, rankPagesForRefinement, structuralRepairLoad } from './pipeline/refine.ts';
export type { RefineOptions, RefineSummary, RefinedPage, StructuralRepairLoad } from './pipeline/refine.ts';
export {
  buildStructuralSnapshot,
  iaGroups,
  iaPageMembership,
  normalizeFacet,
  outlineHashOf,
  sectionHasBody
} from './structure/structural-snapshot.ts';
export type { BuildStructuralSnapshotInput } from './structure/structural-snapshot.ts';
export {
  groupScopeFingerprint,
  runExplicitConsistencyRules,
  runOutlineIntegrityDetectors,
  structuralDetectorVersion,
  structuralFindingKey
} from './structure/structure-detectors.ts';
export {
  facetPrevalenceThreshold,
  maximumFacetLevel,
  minimumCohortSize,
  siblingFacetCandidates
} from './structure/facet-matrix.ts';
export type { FacetCandidate } from './structure/facet-matrix.ts';
export {
  assessmentsFromTranscript,
  buildAssessGroupStructureTask,
  buildSiblingAsymmetryFinding,
  groupAssessmentCacheKey,
  groupAssessmentResultSchema,
  groupAssessorDetectorId,
  groupAssessorPromptVersion,
  structuralAssessmentOutcomes
} from './structure/group-assessor.ts';
export type { GroupAssessment, GroupAssessmentResult } from './structure/group-assessor.ts';
export {
  compareStructuralImpact,
  isOpenStructuralFinding,
  reconcileStructuralFindings
} from './structure/structural-lifecycle.ts';
export {
  createMemoryAssessmentCache,
  createStructuralAssessmentCache,
  structureCacheDir
} from './structure/assessment-cache.ts';
export type { StructuralAssessmentCache } from './structure/assessment-cache.ts';
export { runStructurePass, structuralSummaryLine } from './structure/structure-pass.ts';
export type { StructurePassInput, StructurePassResult, StructurePassTaskRunner } from './structure/structure-pass.ts';
export { runAudit, auditFallbackConfig } from './audit/run-audit.ts';
export type { AuditReport, AuditDefect, RunAuditOptions } from './audit/run-audit.ts';
export { createRunCostTracker, FREEZE_MARGIN_RATIO } from './pipeline/run-cost.ts';
export type { RoleSpend, RunCostTracker } from './pipeline/run-cost.ts';
export { runRecordedTask } from './pipeline/agent-task-record.ts';
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
export { preflightSkipReason, preflightTaskSpec, runTransportPreflight } from './pipeline/preflight-transport.ts';
export type { PreflightInput, PreflightResult } from './pipeline/preflight-transport.ts';
export {
  createTransportFromConfig,
  createTransportForRouting,
  createTaskRunnerFromConfig
} from './pipeline/task-runner.ts';
export type { ConfiguredTaskRunner } from './pipeline/task-runner.ts';
export {
  describeRoleOverrides,
  describeRoleRouting,
  resolveRoleRouting,
  resolveRunRoleRoutings,
  resolveTransportId,
  roleRoutingKey,
  transportDefaultModels
} from './pipeline/agent-role-routing.ts';
export type { InternalTransportId, RoleRouting } from './pipeline/agent-role-routing.ts';
export {
  credentialEnvVarPresent,
  credentialRequirementForRouting,
  isPrivateEndpoint,
  resolveRunCredentialRequirements,
  resolveTransportCredentialRequirement
} from './pipeline/transport-credential.ts';
export type { TransportCredentialKind, TransportCredentialRequirement } from './pipeline/transport-credential.ts';

export { createLocalApp, startLocalServer } from './server/local-server.ts';
export type { LocalAppOptions, LocalServer, LocalServerOptions } from './server/local-server.ts';
export { controlPlaneRouter, createControlPlaneCaller } from './server/trpc-router.ts';
export type {
  ControlPlaneContext,
  ControlPlaneRouter,
  FlagQueueEntry,
  StructuralFindingEntry,
  StructuralQualityView,
  RunListEntry,
  ControlPlaneInjection,
  RunMode,
  RunStartResult
} from './server/trpc-router.ts';
