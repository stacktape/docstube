// Public API of @docstube/contracts — the S0 schema layer everything builds on. This file is the
// deliberate package surface, not a convenience aggregator: consumers import the package name,
// package-internal code imports the concrete files.

export {
  idPrefixes,
  mintId,
  idSchema,
  pageIdSchema,
  sectionIdSchema,
  blockIdSchema,
  claimIdSchema,
  flagIdSchema,
  runIdSchema,
  taskIdSchema,
  knowledgeNeedIdSchema,
  knowledgeFactIdSchema,
  researchAttemptIdSchema,
  contextIdSchema,
  evidenceIdSchema,
  waiverIdSchema,
  entityThreadIdSchema,
  semverSchema,
  isoTimestampSchema,
  localeCodeSchema,
  versionLabelSchema,
  repoPathSchema,
  sha256HexSchema,
  gitShaSchema,
  sourceKeySchema,
  gitCommitSchema,
  contentHashSchema,
  fingerprintPrintSchema,
  entityRevisionSchema,
  symbolSourceKeySchema,
  severitySchema,
  lineSpanSchema
} from './primitives.ts';
export type {
  IdPrefix,
  Severity,
  LineSpan,
  GitCommit,
  ContentHash,
  FingerprintPrint,
  EntityRevision,
  SymbolSourceKey
} from './primitives.ts';

export { sha256Hex, canonicalJson, canonicalStateJson, hashValue, contentHash } from './hashing.ts';

export { normalizeCitedValue, citedValueOccursInText, bindCitedValue, lexNumericTokens } from './cited-value-binding.ts';
export type {
  CitedValueKind,
  NormalizedCitedValue,
  CitedValueBindingIssue,
  CitedValueBindingIssueCode,
  CitedValueBindingResult
} from './cited-value-binding.ts';

export {
  guaranteeLevelSchema,
  sourceRefSchema,
  observedReadSchema,
  verificationResultSchema,
  verificationRecordSchema,
  provenanceSchema
} from './provenance-schema.ts';
export type { GuaranteeLevel, SourceRef, ObservedRead, VerificationRecord, Provenance } from './provenance-schema.ts';

export {
  coreBlockTypes,
  blockTypeSchema,
  componentBlockType,
  claimAnchorSchema,
  claimClassSchema,
  claimEntitySchema,
  codeVariantSchema,
  blockEntitySchema,
  sectionEntitySchema,
  pageEntitySchema,
  entityAddressSchema,
  listPageEntityIds
} from './entity-schema.ts';
export type {
  CoreBlockType,
  BlockType,
  ClaimAnchor,
  ClaimEntity,
  BlockEntity,
  SectionEntity,
  PageEntity,
  EntityAddress
} from './entity-schema.ts';

export {
  symbolKindSchema,
  knownSymbolKinds,
  symbolRecordSchema,
  codemapSchema,
  symbolDiffSchema
} from './symbol-schema.ts';
export type { SymbolRecord, Codemap, SymbolDiff } from './symbol-schema.ts';

export {
  flagKindSchema,
  flagStatusSchema,
  flagAnswerSchema,
  flagSchema,
  autoMergeBlockingFlagKinds
} from './flag-schema.ts';
export type { FlagKind, Flag } from './flag-schema.ts';

export {
  findingSourceSchema,
  findingSchema,
  verifierRunResultSchema,
  criterionResultSchema,
  reviewResultSchema
} from './findings-schema.ts';
export type { Finding, VerifierRunResult, ReviewResult } from './findings-schema.ts';

export {
  manifestPageIndexEntrySchema,
  manifestVersionSchema,
  coverageStatsSchema,
  manifestIndexSchema,
  claimMatchDriftReasonSchema,
  claimMatchRecordSchema,
  claimOrphanRecordSchema,
  claimMatchingSchema,
  pageShardSchema,
  pageShardRelativePath
} from './manifest-schema.ts';
export type {
  ManifestIndex,
  ClaimMatchDriftReason,
  ClaimMatchRecord,
  ClaimOrphanRecord,
  ClaimMatching,
  PageShard
} from './manifest-schema.ts';

export {
  docTypeSchema,
  personaSchema,
  importSourceKindSchema,
  sourcesConfigSchema,
  transportIdSchema,
  agentsConfigSchema,
  versionsConfigSchema,
  localesConfigSchema,
  themeConfigSchema,
  siteConfigSchema,
  autonomyConfigSchema,
  docstubeConfigSchema
} from './config-schema.ts';
export type { DocType, Persona, TransportId, DocstubeConfig, DocstubeConfigInput } from './config-schema.ts';

export { depthBudgetSchema, iaNodeSchema, iaSchema, walkIaNodes } from './ia-schema.ts';
export type { IaNode, Ia } from './ia-schema.ts';

export { glossaryTermSchema, glossarySchema } from './glossary-schema.ts';
export type { GlossaryTerm, Glossary } from './glossary-schema.ts';

export {
  agentTaskKindSchema,
  knownAgentTaskKinds,
  toolDescriptorSchema,
  taskOutputSpecSchema,
  agentTaskSpecSchema,
  transcriptBlockSchema,
  transcriptTurnSchema,
  taskStopReasonSchema,
  taskUsageSchema,
  taskResultSchema,
  transcriptSchema,
  computeTaskCacheKey
} from './agent-task-schema.ts';
export type {
  ToolDescriptor,
  TaskOutputSpec,
  AgentTaskSpec,
  TranscriptBlock,
  TaskResult,
  Transcript
} from './agent-task-schema.ts';

export { failureModeCodes, toFailureModeCode } from './failure-modes.ts';
export type { FailureModeCode } from './failure-modes.ts';

export { pipelineStageSchema, pageStatusSchema, runModeSchema, runEventSchema } from './run-events-schema.ts';
export type { PipelineStage, PageStatus, RunEvent } from './run-events-schema.ts';

export {
  pluginApiVersion,
  pluginPermissionsSchema,
  pluginCapabilityKindSchema,
  pluginCapabilityDeclarationSchema,
  pluginManifestSchema
} from './plugin-manifest-schema.ts';
export type { PluginPermissions, PluginCapabilityKind, PluginManifest } from './plugin-manifest-schema.ts';

export { docstubeConfigJsonSchema, iaJsonSchema, glossaryJsonSchema } from './config-json-schema.ts';

// v2 contract schemas (the 0.1.0 redesign program). Additive: they coexist with the v1 schemas
// above until downstream packages migrate in later waves.

export {
  claimClassTokenSchema,
  builtinClaimClasses,
  isBuiltinClaimClass,
  executionEnvironmentSchema,
  evidenceKindSchema,
  evidenceRefSchema,
  claimCorrectnessSchema,
  claimDispositionSchema,
  claimTrustIssues,
  isOwnerAttested,
  dependencySubscriptionSchema,
  claimMarkerIdSchema,
  proposedSubscriptionSchema,
  proposedEvidenceSchema,
  draftClaimSchema,
  writerClaimLedgerSchema,
  ledgerClaimSchema,
  coverageLintSpanSchema,
  claimLedgerSchema
} from './claim-ledger-schema.ts';
export type {
  ClaimClassToken,
  BuiltinClaimClass,
  ExecutionEnvironment,
  EvidenceKind,
  EvidenceRef,
  ClaimCorrectness,
  ClaimDisposition,
  ClaimTrustState,
  DependencySubscription,
  ProposedSubscription,
  ProposedEvidence,
  DraftClaim,
  WriterClaimLedger,
  LedgerClaim,
  CoverageLintSpan,
  ClaimLedger
} from './claim-ledger-schema.ts';

export { symbolFingerprintSchema, fileFingerprintSchema, fingerprintSnapshotSchema } from './fingerprint-schema.ts';
export type { SymbolFingerprint, FileFingerprint, FingerprintSnapshot } from './fingerprint-schema.ts';

export {
  generationLineageSchema,
  consumedFragmentKindSchema,
  consumedFragmentSchema,
  dependenciesSchema,
  evidenceRecordSchema,
  claimEvidenceSchema,
  criterionOutcomeSchema,
  reviewCompletionSchema,
  personaReviewRoleSchema,
  personaReviewSchema,
  riskCriticResultSchema,
  fidelityAttemptSchema,
  translationFidelitySchema,
  structuralAssessmentSchema,
  assessmentsSchema,
  provenanceV2Schema
} from './provenance-v2-schema.ts';
export type {
  GenerationLineage,
  ConsumedFragment,
  Dependencies,
  EvidenceRecord,
  ClaimEvidence,
  PersonaReview,
  RiskCriticResult,
  FidelityAttempt,
  TranslationFidelity,
  StructuralAssessment,
  Assessments,
  ProvenanceV2
} from './provenance-v2-schema.ts';

export {
  knowledgeSubjectSchema,
  knowledgeNeedKindSchema,
  knowledgeNeedStatusSchema,
  researchAttemptSchema,
  knowledgeNeedSchema,
  knowledgeFactOriginSchema,
  factEvidenceRefSchema,
  knowledgeFactScopeSchema,
  knowledgeFactStatusSchema,
  knowledgeFactPropagationSchema,
  knowledgeFactSchema
} from './knowledge-schema.ts';
export type {
  KnowledgeSubject,
  KnowledgeNeedKind,
  KnowledgeNeed,
  ResearchAttempt,
  FactEvidenceRef,
  KnowledgeFactScope,
  KnowledgeFact
} from './knowledge-schema.ts';

export {
  structuralDetectorSchema,
  structuralScopeSchema,
  structuralAuthoritySchema,
  structuralFindingStatusSchema,
  structuralImpactSchema,
  structuralEvidenceItemSchema,
  structuralFindingSchema,
  structuralSnapshotPageSchema,
  structuralSnapshotSchema
} from './structural-finding-schema.ts';
export type {
  StructuralDetector,
  StructuralScope,
  StructuralAuthority,
  StructuralFindingStatus,
  StructuralFinding,
  StructuralSnapshotPage,
  StructuralSnapshot
} from './structural-finding-schema.ts';

export {
  consistencyModeSchema,
  consistencyRuleCodeSchema,
  builtinConsistencyRuleCodes,
  consistencyRuleSchema,
  iaNodeV2Schema,
  iaV2Schema,
  walkIaV2Nodes,
  convertIaToV2
} from './ia-v2-schema.ts';
export type {
  ConsistencyRule,
  IaPageSourceScope,
  IaGroupConsistency,
  IaGroupNodeV2,
  IaPageNodeV2,
  IaNodeV2,
  IaV2
} from './ia-v2-schema.ts';

export {
  publicationExecutionSchema,
  publicationRegressionKindSchema,
  publicationRegressionSchema,
  blockingDispositionSchema,
  coverageObligationStatusSchema,
  coverageObligationDeltaSchema,
  isCoverageObligationRegression,
  publicationReasonCodeRegistryVersion,
  reasonCodeSchema,
  publicationDecisionSchema,
  outputInventorySchema,
  waiverScopeSchema,
  waiverSchema
} from './publication-schema.ts';
export type {
  PublicationRegression,
  CoverageObligationStatus,
  CoverageObligationDelta,
  PublicationReasonCode,
  PublicationDecision,
  OutputInventory,
  WaiverScope,
  Waiver
} from './publication-schema.ts';

export { supportLevelSchema, supportMatrixSchema, assuranceProfileSchema } from './assurance-schema.ts';
export type { SupportLevel, SupportMatrix, AssuranceProfile } from './assurance-schema.ts';

export {
  archetypeSchema,
  visibilitySchema,
  productKindSchema,
  coveragePolicySchema,
  archetypeDefaultsSchema,
  defaultsForArchetype
} from './archetype-schema.ts';
export type { Archetype, Visibility, ProductKind, CoveragePolicy, ArchetypeDefaults } from './archetype-schema.ts';

export {
  localizationSchedulerStateSchema,
  retryBasisSchema,
  localizationSchedulerRecordSchema,
  localizationRenditionSchema,
  routeResolutionSchema,
  localizationRouteRecordSchema,
  translatableUnitSchema,
  localizationPlanSchema,
  terminologyPolicySchema,
  terminologyEntrySchema,
  terminologyProfileSchema,
  translationMemoryUnitKeySchema
} from './localization-state-schema.ts';
export type {
  LocalizationSchedulerState,
  RetryBasis,
  LocalizationSchedulerRecord,
  LocalizationRendition,
  RouteResolution,
  LocalizationRouteRecord,
  TranslatableUnit,
  LocalizationPlan,
  TerminologyEntry,
  TerminologyProfile,
  TranslationMemoryUnitKey
} from './localization-state-schema.ts';

// Deterministic fixtures shared by downstream package tests.
export {
  buildFixturePage,
  buildFixturePageShard,
  buildFixtureProvenanceV2,
  fixtureConfigInput,
  buildFixtureWriterClaimLedger,
  buildFixtureClaimLedger,
  buildFixtureKnowledgeNeed,
  buildFixtureKnowledgeFact,
  buildFixtureStructuralFinding,
  buildFixturePublicationDecision
} from './fixtures.ts';
