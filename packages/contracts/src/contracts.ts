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
  semverSchema,
  isoTimestampSchema,
  localeCodeSchema,
  versionLabelSchema,
  repoPathSchema,
  sha256HexSchema,
  gitShaSchema,
  sourceKeySchema,
  severitySchema,
  lineSpanSchema
} from './primitives.ts';
export type { IdPrefix, Severity, LineSpan } from './primitives.ts';

export { sha256Hex, canonicalJson, hashValue, contentHash } from './hashing.ts';

export {
  guaranteeLevelSchema,
  rollUpGuarantee,
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
  knownClaimClasses,
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
  pageShardSchema,
  pageShardRelativePath
} from './manifest-schema.ts';
export type { ManifestIndex, PageShard } from './manifest-schema.ts';

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
  claimClassV2Schema,
  executionEnvironmentSchema,
  evidenceKindSchema,
  evidenceRefSchema,
  uncheckedReasonSchema,
  claimDispositionSchema,
  isOwnerAttested,
  fingerprintSubscriptionSchema,
  claimMarkerIdSchema,
  ledgerClaimSchema,
  coverageLintSpanSchema,
  claimLedgerSchema
} from './claim-ledger-schema.ts';
export type {
  ClaimClassV2,
  ExecutionEnvironment,
  EvidenceKind,
  EvidenceRef,
  ClaimDisposition,
  FingerprintSubscription,
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
  claimEvidenceSchema,
  criterionOutcomeSchema,
  reviewCompletionSchema,
  personaReviewSchema,
  riskCriticResultSchema,
  translationFidelitySchema,
  structuralAssessmentSchema,
  assessmentsSchema,
  provenanceV2Schema
} from './provenance-v2-schema.ts';
export type {
  GenerationLineage,
  ConsumedFragment,
  Dependencies,
  ClaimEvidence,
  PersonaReview,
  RiskCriticResult,
  TranslationFidelity,
  StructuralAssessment,
  Assessments,
  ProvenanceV2
} from './provenance-v2-schema.ts';

export {
  knowledgeNeedKindSchema,
  knowledgeNeedStatusSchema,
  knowledgeNeedSchema,
  knowledgeFactOriginSchema,
  factEvidenceRefSchema,
  knowledgeFactScopeSchema,
  knowledgeFactStatusSchema,
  knowledgeFactSchema
} from './knowledge-schema.ts';
export type {
  KnowledgeNeedKind,
  KnowledgeNeed,
  FactEvidenceRef,
  KnowledgeFactScope,
  KnowledgeFact
} from './knowledge-schema.ts';

export {
  structuralDetectorSchema,
  structuralScopeSchema,
  structuralFindingStatusSchema,
  structuralImpactSchema,
  structuralEvidenceItemSchema,
  structuralFindingSchema
} from './structural-finding-schema.ts';
export type {
  StructuralDetector,
  StructuralScope,
  StructuralFindingStatus,
  StructuralFinding
} from './structural-finding-schema.ts';

export { consistencyModeSchema, iaNodeV2Schema, iaV2Schema, walkIaV2Nodes, convertIaToV2 } from './ia-v2-schema.ts';
export type { IaGroupConsistency, IaGroupNodeV2, IaPageNodeV2, IaNodeV2, IaV2 } from './ia-v2-schema.ts';

export {
  publicationExecutionSchema,
  publicationRegressionKindSchema,
  publicationRegressionSchema,
  blockingDispositionSchema,
  coverageDeltaSchema,
  reasonCodeSchema,
  publicationDecisionSchema,
  outputInventorySchema,
  waiverScopeSchema,
  waiverSchema
} from './publication-schema.ts';
export type { PublicationRegression, PublicationDecision, OutputInventory, Waiver } from './publication-schema.ts';

export {
  supportLevelSchema,
  supportMatrixSchema,
  publicationRuleSchema,
  claimClassPolicySchema,
  assuranceProfileSchema
} from './assurance-schema.ts';
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
  localizationStateSchema,
  localizationPublicationStateSchema,
  localizationPageStateSchema,
  translationMemoryUnitKeySchema
} from './localization-state-schema.ts';
export type {
  LocalizationState,
  LocalizationPublicationState,
  LocalizationPageState,
  TranslationMemoryUnitKey
} from './localization-state-schema.ts';

// Deterministic fixtures shared by downstream package tests.
export {
  buildFixturePage,
  buildFixturePageShard,
  fixtureConfigInput,
  buildFixtureClaimLedger,
  buildFixtureKnowledgeNeed,
  buildFixtureKnowledgeFact,
  buildFixtureStructuralFinding,
  buildFixturePublicationDecision
} from './fixtures.ts';
