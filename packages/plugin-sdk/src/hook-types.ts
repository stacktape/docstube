import type { z } from 'zod';
import type {
  Codemap,
  DocstubeConfig,
  Finding,
  Glossary,
  PageEntity,
  SymbolRecord,
  VerifierRunResult
} from '@docstube/contracts';

// Hook definition types — the shapes plugins register through `register(host)`. These carry
// functions, so they live in the SDK rather than in the serializable contracts layer.

// A generated page as verifiers and providers see it: the entity tree plus the MDX it was
// extracted from.
export type PageArtifact = {
  page: PageEntity;
  mdx: string;
  mdxPath: string;
  locale: string;
  version: string;
};

export type BlockTypeRegistry = {
  get: (blockType: string) => { propsSchema: z.ZodType } | undefined;
  list: () => string[];
};

export type PluginLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

// Read access is unrestricted within the repo; writes go through `writeFile`, which enforces the
// plugin's declared writableRoots (ARCHITECTURE.md §6.3).
export type PluginFs = {
  readFile: (repoRelativePath: string) => Promise<string>;
  exists: (repoRelativePath: string) => Promise<boolean>;
  writeFile: (repoRelativePath: string, content: string) => Promise<void>;
};

// Spawn helper limited to the executables the plugin declared in `permissions.exec`.
// `env` replaces the child environment entirely when provided (it is not merged with the host
// env) — callers that need scrubbing pass an explicit minimal set; omitting it inherits the host.
export type PluginExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; input?: string; timeoutMs?: number; env?: Record<string, string> }
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export type VerifierContext = {
  repoRoot: string;
  config: DocstubeConfig;
  codemap: Codemap;
  glossary: Glossary;
  registry: BlockTypeRegistry;
  fs: PluginFs;
  exec: PluginExec;
  logger: PluginLogger;
};

export type VerifierAppliesTo = {
  // Restrict to specific block types ("code-example", "component:Diagram"); absent = all.
  blockTypes?: string[] | undefined;
  // For code-example blocks: restrict to these languages.
  languages?: string[] | undefined;
};

export type VerifierDefinition = {
  id: string;
  title: string;
  description?: string | undefined;
  // 'block' verifiers receive matching blocks page by page; 'page' verifiers see whole pages;
  // 'site' verifiers run once over everything (cross-page links, orphans, contradictions).
  scope: 'block' | 'page' | 'site';
  appliesTo?: VerifierAppliesTo | undefined;
  // i18n semantics (PRODUCT §7.8): structural checks run per locale, code checks usually
  // source-only.
  localeScope: 'source-only' | 'per-locale';
  // Whether a pass PROVES the covered claims (guarantee: proven) or merely checks hygiene.
  proves: boolean;
  verify: (ctx: VerifierContext, pages: PageArtifact[]) => Promise<VerifierRunResult>;
};

export type LanguagePackContext = {
  repoRoot: string;
  // Repo-relative files matching the pack's extensions, pre-walked by the host.
  files: string[];
  readFile: (repoRelativePath: string) => Promise<string>;
  // Kernel-owned symbol hashing — packs must use this so hashes stay consistent across packs
  // and docstube versions (the hash IS the provenance key).
  hashSymbol: (input: { lang: string; kind: string; containerPath: string[]; normalizedDeclaration: string }) => string;
  logger: PluginLogger;
};

export type SnippetRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type LanguagePackDefinition = {
  id: string;
  displayName: string;
  fileExtensions: string[];
  // Deterministic detection for the wizard/doctor (manifest sniffing, <1s, no agent calls).
  detect?: ((repoRoot: string) => Promise<boolean>) | undefined;
  extractSymbols: (ctx: LanguagePackContext) => Promise<SymbolRecord[]>;
  snippetToolchain?:
    | {
        typecheck?: ((code: string, ctx: { repoRoot: string }) => Promise<Finding[]>) | undefined;
        run?: ((code: string, ctx: { repoRoot: string; timeoutMs: number }) => Promise<SnippetRunResult>) | undefined;
      }
    | undefined;
};

export type ContentSourceContext = {
  repoRoot: string;
  readFile: (repoRelativePath: string) => Promise<string>;
  hashSymbol: (input: { lang: string; kind: string; containerPath: string[]; normalizedDeclaration: string }) => string;
  logger: PluginLogger;
};

// Non-code truth sources (OpenAPI/AsyncAPI): produce symbol-like records that participate in
// provenance and verification exactly like code symbols.
export type ContentSourceDefinition = {
  id: string;
  detect?: ((repoRoot: string) => Promise<string[]>) | undefined;
  ingest: (ctx: ContentSourceContext, location: string) => Promise<SymbolRecord[]>;
};

export type ImportedReferenceContext = {
  documents: Array<{ title: string; content: string; sourceLocation?: string | undefined }>;
};

// Foreign docs as reference context (tone, structure, tribal knowledge). Imported claims are
// UNVERIFIED until re-grounded against source — importers never produce shippable content.
export type ImporterDefinition = {
  id: string;
  kind: 'mintlify' | 'gitbook' | 'readme-com' | 'confluence' | (string & {});
  importContext: (ctx: { logger: PluginLogger }, location: string) => Promise<ImportedReferenceContext>;
};

export type DeployTargetDefinition = {
  id: string;
  // Writes CI/deploy scaffolding (workflow files, config) into the repo.
  scaffold: (ctx: { fs: PluginFs; config: DocstubeConfig; logger: PluginLogger }) => Promise<void>;
};

export type SearchProviderDefinition = {
  id: string;
  // Runs at assemble time over the built site output.
  buildIndex: (ctx: { siteDir: string; exec: PluginExec; logger: PluginLogger }) => Promise<void>;
};

// A theme/MDX component: registering one adds the block type `component:<name>` to the open enum
// (PRODUCT §3.1). `source` is vendored into generated sites for plugin-provided components;
// built-in components resolve from the theme.
export type ComponentDefinition = {
  name: string;
  description: string;
  propsSchema: z.ZodType;
  category?: string | undefined;
  source?: { modulePath: string } | undefined;
};

export type PluginRegistrationHost = {
  verifier: (definition: VerifierDefinition) => void;
  languagePack: (definition: LanguagePackDefinition) => void;
  contentSource: (definition: ContentSourceDefinition) => void;
  importer: (definition: ImporterDefinition) => void;
  deployTarget: (definition: DeployTargetDefinition) => void;
  searchProvider: (definition: SearchProviderDefinition) => void;
  component: (definition: ComponentDefinition) => void;
};
