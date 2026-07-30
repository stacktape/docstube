import { z } from 'zod';
import { localeCodeSchema, repoPathSchema, versionLabelSchema } from './primitives.ts';

// docstube.yml — intent only, single source of truth (PRODUCT §3.9.5). The wizard is one editor
// among others; agents and humans edit it directly. Derived state never lives here, secrets never
// live here (env/keychain only; credentials are referenced by env-var NAME).

export const docTypeSchema = z.enum(['internal', 'external-library', 'external-product']);
export type DocType = z.infer<typeof docTypeSchema>;

export const personaSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1)
});
export type Persona = z.infer<typeof personaSchema>;

// 'readme-com' is the ReadMe.com docs platform, not a repository README.md.
export const importSourceKindSchema = z.enum(['mintlify', 'gitbook', 'readme-com', 'confluence']);

export const sourcesConfigSchema = z.strictObject({
  // OpenAPI/AsyncAPI specs are first-class truth sources next to code (PRODUCT §4.1).
  openapi: z.array(repoPathSchema).default([]),
  asyncapi: z.array(repoPathSchema).default([]),
  // Existing docs as reference context; imported claims are unverified until re-grounded.
  imports: z.array(z.strictObject({ kind: importSourceKindSchema, location: z.string().min(1) })).default([])
});

// The PUBLIC transport surface. 'google' (Antigravity CLI drops subprocess stdout) and 'replay'
// (internal test transport) exist in agent-runtime but are internal/experimental — reachable only
// through DOCSTUBE_TRANSPORT_OVERRIDE, never through docstube.yml.
export const transportIdSchema = z.enum(['claude-cli', 'codex-cli', 'anthropic-api', 'openai-compatible']);
export type TransportId = z.infer<typeof transportIdSchema>;

// ONE ROLE OVERRIDE: a transport, a model, or both. Whatever the role does not name is INHERITED
// from the top-level `agents:` block (see resolveRoleRouting in core — the single implementation of
// this order). Credentials are deliberately not per-role: a role that switches transport uses that
// transport's own default credential env var, because agents.apiKeyEnv holds a key issued by the
// top-level provider and must never be sent to a different one.
export const agentRoleConfigSchema = z.strictObject({
  transport: transportIdSchema.optional(),
  model: z.string().optional()
});
export type AgentRoleConfig = z.infer<typeof agentRoleConfigSchema>;

// PER-ROLE OVERRIDES, ROUTED FOR REAL. Every model task declares a role (agentRoleByTaskKind), and
// an unset role inherits the top-level transport AND model — so this block is a pure cost/quality
// lever: point `reviewer` or `translator` at an economy model and only those tasks move.
// Every key here is one of agentRoleSchema's values; the contracts spec asserts the two stay in
// sync, so a role can never be configurable without being routed.
export const agentRolesConfigSchema = z.strictObject({
  writer: agentRoleConfigSchema.optional(),
  reviewer: agentRoleConfigSchema.optional(),
  'risk-critic': agentRoleConfigSchema.optional(),
  translator: agentRoleConfigSchema.optional(),
  architect: agentRoleConfigSchema.optional(),
  extractor: agentRoleConfigSchema.optional()
});

export const agentsConfigSchema = z.strictObject({
  transport: transportIdSchema.default('claude-cli'),
  model: z.string().optional(),
  // For openai-compatible: preset base URLs cover OpenAI/Ollama/anything compatible (§3.6).
  baseUrl: z.string().url().optional(),
  // Name of the env var holding the credential — never the credential itself.
  apiKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  // NOTE: the old `reviewModel` shortcut is gone — `roles.reviewer` says the same thing and can
  // also move the reviewer to a different PROVIDER, which is what reviewer independence actually
  // requires. Two spellings of one routing rule is how the two drift apart.
  roles: agentRolesConfigSchema.prefault({}),
  // Each default is written once at field level; `.prefault({})` parses the empty object through
  // the schema so nested field defaults apply (Zod 4 `.default()` would short-circuit).
  budgets: z
    .strictObject({
      // Approximate caps — freeze with margin (PRODUCT §3.5).
      maxRunUsd: z
        .number()
        .positive()
        .default(20)
        .describe(
          'Approximate per-run USD cap. Cap-freeze stops the run between pages at 85% of this value so in-flight work stays under the cap.'
        ),
      maxTurnsPerTask: z.number().int().positive().default(24),
      maxToolCallsPerTask: z.number().int().positive().default(64),
      maxPlanUsagePercent: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(80)
        .describe(
          'For subscription transports that report plan usage (codex rate limits): freeze the run between pages once the busier window (5h or weekly) reaches this percentage. When a plan-usage signal is present, dollar ESTIMATES stop triggering the freeze — the plan signal is the truth for subscription billing.'
        )
    })
    .prefault({})
});

export const versionsConfigSchema = z.strictObject({
  current: versionLabelSchema.default('latest'),
  frozen: z.array(versionLabelSchema).default([])
});

// TARGETS ARE OTHER LOCALES, EXACTLY ONCE EACH (wave 2b close 2 finding): the source locale is
// truth, so listing it as a target asks the pipeline to translate a page into the language it is
// already written in, and a repeated target asks for the same rendition twice — each one burns
// agent budget and both write the same /<locale>/<slug> route. Comparison is case-INsensitive, the
// same rule localeRoutePrefixConflict uses: locale codes name route DIRECTORIES, so "pt-BR" and
// "pt-br" are one target on the case-insensitive filesystems most contributors use.
export const localesConfigSchema = z
  .strictObject({
    source: localeCodeSchema.default('en'),
    targets: z.array(localeCodeSchema).default([])
  })
  .superRefine((locales, ctx) => {
    const seen = new Set<string>();
    locales.targets.forEach((target, index) => {
      const normalized = target.toLowerCase();
      if (normalized === locales.source.toLowerCase()) {
        ctx.addIssue({
          code: 'custom',
          path: ['targets', index],
          message:
            `locales.targets contains the source locale "${target}" (locales.source is "${locales.source}"): ` +
            'the source locale is the original, never a translation target. Remove it from locales.targets'
        });
        return;
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: 'custom',
          path: ['targets', index],
          message:
            `locales.targets lists "${target}" more than once (locale codes are compared case-insensitively ` +
            'because they name route directories). Remove the duplicate'
        });
        return;
      }
      seen.add(normalized);
    });
  });

export const themeConfigSchema = z.strictObject({
  // Built-in theme rendering the emitted site. The wizard always writes an explicit name, so a
  // later change of the shipped default never restyles an existing repo. Unknown names are a hard
  // error at emit time (listing the available themes).
  name: z.string().min(1).default('basic'),
  // Design tokens (CSS custom-property values) applied to the emitted site.
  tokens: z
    .record(z.string(), z.string())
    .default({})
    .describe(
      'Design-token overrides. Four semantic tokens are honored by EVERY theme: accent (brand color), ' +
        'accentDark (accent for dark surfaces/modes), fontBody (body font stack), fontCode (code font stack). ' +
        "Any other name is a theme-scoped CSS custom property — it maps onto the selected theme's own " +
        'variables and may do nothing under a different theme.'
    )
});

// logo/favicon are SITE metadata (PRODUCT §3.9.2 groups them with title/description) — a hand
// editor looks for `favicon:` under `site:`, not `theme:`.
export const siteConfigSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().default(''),
  baseUrl: z.string().url().optional(),
  layout: z.enum(['single-tree', 'sectioned']).default('single-tree'),
  footerCredit: z.boolean().default(true),
  logo: repoPathSchema.optional(),
  favicon: repoPathSchema.optional()
});

// The whole family is strict (z.strictObject): docstube.yml is human-edited, so an unknown key is
// a hard error — a typo'd option (or a mistyped secret-looking key) must never be silently dropped.
export const docstubeConfigSchema = z.strictObject({
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
  // NOTE (impl-07 finding 8 / quality-ci-reader-v2 §7): the reserved `autonomy` policy block and
  // the `screenshots` stub were deleted — validated-but-unenforced config keys are fake
  // affordances. The v2 policy engine and screenshot capture add their config WITH their
  // implementations.
  outDir: repoPathSchema.default('docs-site'),
  telemetry: z.strictObject({ enabled: z.boolean().default(true) }).prefault({})
});
export type DocstubeConfig = z.infer<typeof docstubeConfigSchema>;
export type DocstubeConfigInput = z.input<typeof docstubeConfigSchema>;
