export type S0ContractArea =
  | 'adapter-event'
  | 'agent-adapter'
  | 'cache-key'
  | 'config'
  | 'criteria'
  | 'deterministic-check'
  | 'feedback'
  | 'generated-page'
  | 'manifest'
  | 'registry-component'
  | 'state-backend'
  | 'trpc-router';

export const s0ContractAreas = [
  'config',
  'criteria',
  'feedback',
  'manifest',
  'adapter-event',
  'cache-key',
  'deterministic-check',
  'generated-page',
  'state-backend',
  'agent-adapter',
  'registry-component',
  'trpc-router'
] as const satisfies readonly S0ContractArea[];

export {
  identifierSchema,
  jsonValueSchema,
  packageNameSchema,
  packageVersionSchema,
  relativePathSchema,
  semverSchema,
  severities,
  severitySchema,
  timestampSchema
} from './primitives';
export type {
  Identifier,
  JsonValue,
  PackageName,
  PackageVersion,
  RelativePath,
  Semver,
  Severity,
  Timestamp
} from './primitives';

export { contractFixtures, errorCoversPaths, issuePaths } from './fixtures';
export type { ContractFixtureName, ContractFixtures, InvalidCase, IssuePath, ValidCase } from './fixtures';

export {
  agentAdapters,
  agentAdapterSchema,
  agentChoiceSchema,
  agentsSchema,
  apiProviders,
  apiProviderSchema,
  componentNameSchema,
  docstubeConfigSchema,
  docsTypes,
  docsTypeSchema,
  layouts,
  layoutSchema,
  outputSchema,
  personaSchema,
  screenshotsConfigSchema,
  siteMetadataSchema,
  sourceReferenceSchema,
  themeSchema,
  usageCapsSchema
} from './config-schema';
export type {
  AgentAdapterKind,
  AgentChoice,
  AgentsConfig,
  ApiProvider,
  DocsType,
  DocstubeConfig,
  Layout,
  OutputConfig,
  Persona,
  ScreenshotsConfig,
  SiteMetadata,
  SourceReference,
  ThemeConfig,
  UsageCaps
} from './config-schema';

export { iaNodeSchema, iaSchema } from './ia-schema';
export type { Ia, IaNode } from './ia-schema';

export { glossarySchema, glossaryTermSchema } from './glossary-schema';
export type { Glossary, GlossaryTerm } from './glossary-schema';

export {
  ConfigValidationError,
  parseDocstubeConfig,
  parseGlossary,
  parseIa,
  safeParseDocstubeConfig,
  safeParseGlossary,
  safeParseIa
} from './config-validation';
export type { ConfigFamilyFile, ConfigParseResult } from './config-validation';

export {
  configFamilyJsonSchemas,
  docstubeConfigJsonSchema,
  glossaryJsonSchema,
  iaJsonSchema
} from './config-json-schema';
export type { JsonSchema } from './config-json-schema';

export { configFamilyFixtures, docstubeConfigFixtures, glossaryFixtures, iaFixtures } from './config-fixtures';
export type { ConfigFamilyFixtureName, ConfigFamilyFixtures } from './config-fixtures';

export {
  buildSectionMarker,
  extractSectionMarkers,
  parseSectionMarker,
  sectionMarkerKinds,
  sectionMarkerNamespace
} from './section-markers';
export type { SectionMarker, SectionMarkerKind } from './section-markers';

export {
  checkSectionPresence,
  duplicatePageIds,
  duplicateSectionIds,
  generatedPageFrontmatterSchema,
  generatedStampSchema,
  pageIdSchema,
  pageStatuses,
  pageStatusSchema,
  sectionIdSchema
} from './page-schema';
export type {
  GeneratedPageFrontmatter,
  GeneratedStamp,
  PageId,
  PageStatus,
  SectionId,
  SectionPresenceResult
} from './page-schema';

export { cacheKeyFields, cacheKeyInputSchema, deriveCacheKey, sha256Schema } from './cache-key';
export type { CacheKeyInput, Sha256 } from './cache-key';

export { findingLocationSchema, findingOrigins, findingOriginSchema, findingSchema } from './findings-schema';
export type { Finding, FindingLocation, FindingOrigin } from './findings-schema';

export { criteriaChecklistSchema, criteriaItemSchema, criteriaScopes, criteriaScopeSchema } from './criteria-schema';
export type { CriteriaChecklist, CriteriaItem, CriteriaScope } from './criteria-schema';

export {
  feedbackCategories,
  feedbackCategorySchema,
  feedbackRecordSchema,
  feedbackScopes,
  feedbackScopeSchema,
  feedbackStatuses,
  feedbackStatusSchema
} from './feedback-schema';
export type { FeedbackCategory, FeedbackRecord, FeedbackScope, FeedbackStatus } from './feedback-schema';

export { manifestPageSchema, manifestSchema, pageProvenanceSchema, provenanceCitationSchema } from './manifest-schema';
export type { Manifest, ManifestPage, PageProvenance, ProvenanceCitation } from './manifest-schema';

export { checkResultSchema, checkStatuses, checkStatusSchema } from './check-result-schema';
export type { CheckResult, CheckStatus } from './check-result-schema';

export {
  componentStatuses,
  componentStatusSchema,
  propSchemaRefSchema,
  registryComponentSchema,
  registrySchema,
  reservedComponentNames
} from './registry-schema';
export type { ComponentRegistry, ComponentStatus, PropSchemaRef, RegistryComponent } from './registry-schema';

export { s0Fixtures } from './s0-fixtures';
export type { S0FixtureName, S0Fixtures } from './s0-fixtures';
