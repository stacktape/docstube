// Public API of @docstube/plugin-sdk — everything a plugin author needs, and nothing that couples
// them to docstube internals. Experimental until docstube 1.0 (breaking changes between minors,
// documented in the changelog); semver-stable after.

export { definePlugin, isDocstubePlugin, pluginBrand } from './define-plugin.ts';
export type { DocstubePlugin, DefinePluginInput } from './define-plugin.ts';

export type {
  PageArtifact,
  BlockTypeRegistry,
  PluginLogger,
  PluginFs,
  PluginExec,
  VerifierContext,
  VerifierAppliesTo,
  VerifierDefinition,
  LanguagePackContext,
  SnippetRunResult,
  LanguagePackDefinition,
  ContentSourceContext,
  ContentSourceDefinition,
  ImportedReferenceContext,
  ImporterDefinition,
  DeployTargetDefinition,
  SearchProviderDefinition,
  ComponentDefinition,
  PluginRegistrationHost
} from './hook-types.ts';

// Contract types plugin authors work with (bundled — plugins never install @docstube/contracts).
export {
  pluginApiVersion,
  pluginManifestSchema,
  pluginPermissionsSchema,
  pluginCapabilityKindSchema,
  coreBlockTypes,
  blockTypeSchema,
  componentBlockType,
  findingSchema,
  verifierRunResultSchema,
  severitySchema,
  symbolRecordSchema,
  knownSymbolKinds
} from '@docstube/contracts';
export type {
  PluginManifest,
  PluginPermissions,
  PluginCapabilityKind,
  BlockType,
  PageEntity,
  SectionEntity,
  BlockEntity,
  EntityAddress,
  Finding,
  VerifierRunResult,
  Severity,
  SymbolRecord,
  Codemap,
  SymbolDiff,
  DocstubeConfig,
  Glossary
} from '@docstube/contracts';
