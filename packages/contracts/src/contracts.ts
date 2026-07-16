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
  semverSchema,
  isoTimestampSchema,
  localeCodeSchema,
  versionLabelSchema,
  repoPathSchema,
  sha256HexSchema,
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

// Deterministic fixtures shared by downstream package tests.
export { buildFixturePage, buildFixturePageShard, fixtureConfigInput } from './fixtures.ts';
