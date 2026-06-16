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
} from './primitives.ts';
export type {
  Identifier,
  JsonValue,
  PackageName,
  PackageVersion,
  RelativePath,
  Semver,
  Severity,
  Timestamp
} from './primitives.ts';

export { contractFixtures, errorCoversPaths, issuePaths } from './fixtures.ts';
export type { ContractFixtureName, ContractFixtures, InvalidCase, IssuePath, ValidCase } from './fixtures.ts';

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
} from './config-schema.ts';
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
} from './config-schema.ts';

export { iaNodeSchema, iaSchema } from './ia-schema.ts';
export type { Ia, IaNode } from './ia-schema.ts';

export { glossarySchema, glossaryTermSchema } from './glossary-schema.ts';
export type { Glossary, GlossaryTerm } from './glossary-schema.ts';

export {
  ConfigValidationError,
  parseDocstubeConfig,
  parseGlossary,
  parseIa,
  safeParseDocstubeConfig,
  safeParseGlossary,
  safeParseIa
} from './config-validation.ts';
export type { ConfigFamilyFile, ConfigParseResult } from './config-validation.ts';

export {
  configFamilyJsonSchemas,
  docstubeConfigJsonSchema,
  glossaryJsonSchema,
  iaJsonSchema
} from './config-json-schema.ts';
export type { JsonSchema } from './config-json-schema.ts';

export { configFamilyFixtures, docstubeConfigFixtures, glossaryFixtures, iaFixtures } from './config-fixtures.ts';
export type { ConfigFamilyFixtureName, ConfigFamilyFixtures } from './config-fixtures.ts';

export {
  buildSectionMarker,
  extractSectionMarkers,
  parseSectionMarker,
  sectionMarkerKinds,
  sectionMarkerNamespace
} from './section-markers.ts';
export type { SectionMarker, SectionMarkerKind } from './section-markers.ts';

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
} from './page-schema.ts';
export type {
  GeneratedPageFrontmatter,
  GeneratedStamp,
  PageId,
  PageStatus,
  SectionId,
  SectionPresenceResult
} from './page-schema.ts';

export { cacheKeyFields, cacheKeyInputSchema, deriveCacheKey, sha256Schema } from './cache-key.ts';
export type { CacheKeyInput, Sha256 } from './cache-key.ts';

export { findingLocationSchema, findingOrigins, findingOriginSchema, findingSchema } from './findings-schema.ts';
export type { Finding, FindingLocation, FindingOrigin } from './findings-schema.ts';

export { criteriaChecklistSchema, criteriaItemSchema, criteriaScopes, criteriaScopeSchema } from './criteria-schema.ts';
export type { CriteriaChecklist, CriteriaItem, CriteriaScope } from './criteria-schema.ts';

export {
  feedbackCategories,
  feedbackCategorySchema,
  feedbackRecordSchema,
  feedbackScopes,
  feedbackScopeSchema,
  feedbackStatuses,
  feedbackStatusSchema
} from './feedback-schema.ts';
export type { FeedbackCategory, FeedbackRecord, FeedbackScope, FeedbackStatus } from './feedback-schema.ts';

export {
  manifestPageSchema,
  manifestSchema,
  pageProvenanceSchema,
  provenanceCitationSchema
} from './manifest-schema.ts';
export type { Manifest, ManifestPage, PageProvenance, ProvenanceCitation } from './manifest-schema.ts';

export { checkResultSchema, checkStatuses, checkStatusSchema } from './check-result-schema.ts';
export type { CheckResult, CheckStatus } from './check-result-schema.ts';

export {
  componentStatuses,
  componentStatusSchema,
  propSchemaRefSchema,
  registryComponentSchema,
  registrySchema,
  reservedComponentNames
} from './registry-schema.ts';
export type { ComponentRegistry, ComponentStatus, PropSchemaRef, RegistryComponent } from './registry-schema.ts';

export { s0Fixtures } from './s0-fixtures.ts';
export type { S0FixtureName, S0Fixtures } from './s0-fixtures.ts';
