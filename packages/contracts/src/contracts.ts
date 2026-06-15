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
