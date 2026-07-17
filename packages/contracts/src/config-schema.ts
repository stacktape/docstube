import { z } from 'zod';
import { localeCodeSchema, repoPathSchema, versionLabelSchema } from './primitives.ts';

// docstube.yml — intent only, single source of truth (PRODUCT §3.9.5). The wizard is one editor
// among others; agents and humans edit it directly. Derived state never lives here, secrets never
// live here (env/keychain only; credentials are referenced by env-var NAME).

export const docTypeSchema = z.enum(['internal', 'external-library', 'external-product']);
export type DocType = z.infer<typeof docTypeSchema>;

export const personaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1)
});
export type Persona = z.infer<typeof personaSchema>;

// 'readme-com' is the ReadMe.com docs platform, not a repository README.md.
export const importSourceKindSchema = z.enum(['mintlify', 'gitbook', 'readme-com', 'confluence']);

export const sourcesConfigSchema = z.object({
  // OpenAPI/AsyncAPI specs are first-class truth sources next to code (PRODUCT §4.1).
  openapi: z.array(repoPathSchema).default([]),
  asyncapi: z.array(repoPathSchema).default([]),
  // Existing docs as reference context; imported claims are unverified until re-grounded.
  imports: z.array(z.object({ kind: importSourceKindSchema, location: z.string().min(1) })).default([])
});

// The PUBLIC transport surface. 'google' (Antigravity CLI drops subprocess stdout) and 'replay'
// (internal test transport) exist in agent-runtime but are internal/experimental — reachable only
// through DOCSTUBE_TRANSPORT_OVERRIDE, never through docstube.yml.
export const transportIdSchema = z.enum(['claude-cli', 'codex-cli', 'anthropic-api', 'openai-compatible']);
export type TransportId = z.infer<typeof transportIdSchema>;

export const agentRoleConfigSchema = z.object({
  transport: transportIdSchema.optional(),
  model: z.string().optional()
});

export const agentsConfigSchema = z.object({
  transport: transportIdSchema.default('claude-cli'),
  model: z.string().optional(),
  reviewModel: z
    .string()
    .optional()
    .describe(
      'Model used for review tasks; defaults to agents.model. Pointing it at a different (cheaper) model breaks self-review correlation.'
    ),
  // For openai-compatible: preset base URLs cover OpenAI/Ollama/anything compatible (§3.6).
  baseUrl: z.string().url().optional(),
  // Name of the env var holding the credential — never the credential itself.
  apiKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  // Per-role overrides; unset roles inherit the top-level transport/model.
  roles: z
    .object({
      writer: agentRoleConfigSchema.optional(),
      reviewer: agentRoleConfigSchema.optional(),
      translator: agentRoleConfigSchema.optional()
    })
    .optional(),
  // Each default is written once at field level; `.prefault({})` parses the empty object through
  // the schema so nested field defaults apply (Zod 4 `.default()` would short-circuit).
  budgets: z
    .object({
      // Approximate caps — freeze with margin (PRODUCT §3.5).
      maxRunUsd: z
        .number()
        .positive()
        .default(20)
        .describe(
          'Approximate per-run USD cap. Cap-freeze stops the run between pages at 85% of this value so in-flight work stays under the cap.'
        ),
      maxTurnsPerTask: z.number().int().positive().default(24),
      maxToolCallsPerTask: z.number().int().positive().default(64)
    })
    .prefault({})
});

export const versionsConfigSchema = z.object({
  current: versionLabelSchema.default('latest'),
  frozen: z.array(versionLabelSchema).default([])
});

export const localesConfigSchema = z.object({
  source: localeCodeSchema.default('en'),
  targets: z.array(localeCodeSchema).default([])
});

export const themeConfigSchema = z.object({
  // Design tokens (CSS custom-property values) applied to the emitted site.
  tokens: z.record(z.string(), z.string()).default({}),
  logo: repoPathSchema.optional(),
  favicon: repoPathSchema.optional()
});

export const siteConfigSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  baseUrl: z.string().url().optional(),
  layout: z.enum(['single-tree', 'sectioned']).default('single-tree'),
  footerCredit: z.boolean().default(true)
});

// Reserved v2 policy-engine surface (PRODUCT §4.2) — validated now, enforced later. v1 uses the
// hardcoded exception rules regardless of what this says.
export const autonomyConfigSchema = z.object({
  default: z
    .object({
      mode: z.enum(['auto-merge', 'review']).default('auto-merge'),
      guaranteeFloor: z.enum(['proven', 'scored', 'out-of-domain']).optional()
    })
    .prefault({}),
  rules: z
    .array(
      z.object({
        glob: z.string().min(1),
        mode: z.enum(['auto-merge', 'review']),
        guaranteeFloor: z.enum(['proven', 'scored', 'out-of-domain']).optional()
      })
    )
    .default([])
});

export const docstubeConfigSchema = z.object({
  schemaVersion: z.literal(1),
  docType: docTypeSchema,
  // Short free-text: what the project is, who it's for. Extracted, never generated.
  projectContext: z.string().default(''),
  personas: z.array(personaSchema).min(1),
  // `.prefault({})` (not `.default({})`) so each nested default is written exactly once at field
  // level and still applies when the whole block is omitted.
  sources: sourcesConfigSchema.prefault({}),
  agents: agentsConfigSchema.prefault({}),
  versions: versionsConfigSchema.prefault({}),
  locales: localesConfigSchema.prefault({}),
  theme: themeConfigSchema.prefault({}),
  site: siteConfigSchema,
  // Enabled MDX components; must exist in the block-type registry (open enum, §3.1/§3.4).
  components: z.array(z.string().min(1)).default([]),
  // npm package names ("docstube-plugin-x") or repo-relative paths ("./plugins/y.ts").
  plugins: z.array(z.string().min(1)).default([]),
  // Doc-type-conditional coverage metric; 'auto' derives from docType.
  coverage: z.enum(['on', 'off', 'auto']).default('auto'),
  autonomy: autonomyConfigSchema.optional(),
  outDir: repoPathSchema.default('docs-site'),
  telemetry: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  // Reserved: screenshot capture is a declared TBD boundary (PRODUCT §6).
  screenshots: z.unknown().optional()
});
export type DocstubeConfig = z.infer<typeof docstubeConfigSchema>;
export type DocstubeConfigInput = z.input<typeof docstubeConfigSchema>;
