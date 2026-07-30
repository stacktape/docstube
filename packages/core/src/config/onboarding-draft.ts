import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { DocstubeConfig, DocstubeConfigInput, Ia } from '@docstube/contracts';
import { docstubeConfigSchema, iaSchema, transportIdSchema } from '@docstube/contracts';
import { CoreError } from '../errors.ts';
import { loadConfigFamily } from './config-io.ts';

// THE ONBOARDING DRAFT (PRODUCT §3.9.2, dx-knowledge-v2 decision 1) — the fix for the first-run
// circularity: setup's agent-backed steps (IA proposal, theme extraction) need a task runner, a
// task runner needs `agents:` settings, and `agents:` lives in a docstube.yml that does not exist
// until setup finishes. The draft holds that in-progress intent BEFORE any config is committed,
// so those steps run from it instead.
//
// It is machine-local and gitignored, and it is NEVER committed state: `status`, `check`, the
// GitHub Action and the manifest store read docstube.yml and nothing else. Only the setup
// surfaces (and the setup-scoped control-plane procedures) ever look at it.

export const onboardingDraftRelativePath = '.docstube/onboarding-draft.json';

// Provider choice. The one draft field the SERVER reads on its own — everything else is intent the
// setup UI round-trips. Mirrors the docstube.yml `agents:` fields the transport factory needs;
// still never a credential, only the env-var NAME.
export const draftAgentSettingsSchema = z.strictObject({
  transport: transportIdSchema.optional(),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional()
});
export type DraftAgentSettings = z.infer<typeof draftAgentSettingsSchema>;

export const onboardingDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  // Where the user was in setup; a reload resumes there instead of restarting.
  step: z.number().int().min(0).optional(),
  agents: draftAgentSettingsSchema.prefault({}),
  // The in-progress config intent as the setup UI holds it — deliberately partial and deliberately
  // NOT parsed as a config: half-filled setup is not valid config, and pretending otherwise is what
  // forced the old wizard to require a committed file before it could work.
  config: z.record(z.string(), z.unknown()).prefault({}),
  ia: z.record(z.string(), z.unknown()).optional(),
  // Result of the last transport preflight, so the Generate step can show it without re-billing.
  preflight: z.strictObject({ ok: z.boolean(), detail: z.string(), at: z.string().min(1) }).optional()
});
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

// Every field optional: the UI autosaves whatever changed.
export const onboardingDraftPatchSchema = onboardingDraftSchema
  .omit({ schemaVersion: true, updatedAt: true })
  .partial();
export type OnboardingDraftPatch = z.infer<typeof onboardingDraftPatchSchema>;

const draftPath = (repoRoot: string): string => join(repoRoot, ...onboardingDraftRelativePath.split('/'));

export const emptyOnboardingDraft = (): OnboardingDraft =>
  onboardingDraftSchema.parse({ schemaVersion: 1, updatedAt: new Date().toISOString() });

// A corrupt or stale-shaped draft is never fatal — setup starts clean rather than dead-ending the
// only surface that could fix it.
export const readOnboardingDraft = async (repoRoot: string): Promise<OnboardingDraft | undefined> => {
  let text: string;
  try {
    text = await readFile(draftPath(repoRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  try {
    return onboardingDraftSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
};

export const saveOnboardingDraft = async (repoRoot: string, patch: OnboardingDraftPatch): Promise<OnboardingDraft> => {
  const current = (await readOnboardingDraft(repoRoot)) ?? emptyOnboardingDraft();
  const next = onboardingDraftSchema.parse({
    ...current,
    ...patch,
    // Shallow-merge the agent block so saving a model does not erase the transport.
    agents: { ...current.agents, ...patch.agents },
    schemaVersion: 1,
    updatedAt: new Date().toISOString()
  });
  const path = draftPath(repoRoot);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
};

export const clearOnboardingDraft = async (repoRoot: string): Promise<void> => {
  await rm(draftPath(repoRoot), { force: true });
};

export const draftIa = (draft: OnboardingDraft): Ia | undefined => {
  if (draft.ia === undefined) {
    return undefined;
  }
  const result = iaSchema.safeParse(draft.ia);
  return result.success ? result.data : undefined;
};

// Placeholder persona used ONLY to make a half-filled draft parse as a config for prompt context.
// It is never written to docstube.yml — `setup.commit` writes the user's own intent.
const placeholderPersona = { id: 'reader', description: 'Reader of these docs (placeholder — setup not finished).' };

const mergedAgents = (intentAgents: unknown, draftAgents: DraftAgentSettings): Record<string, unknown> => ({
  ...(typeof intentAgents === 'object' && intentAgents !== null ? (intentAgents as Record<string, unknown>) : {}),
  ...Object.fromEntries(Object.entries(draftAgents).filter(([, value]) => value !== undefined))
});

// Builds the config an agent-backed SETUP step runs on. Real intent wherever the user supplied it,
// placeholders only for the required fields they have not reached yet. Never written to disk.
export const draftSetupConfig = (draft: OnboardingDraft, repoRoot: string): DocstubeConfig => {
  const intent = draft.config as Partial<DocstubeConfigInput>;
  const fallbackTitle = basename(repoRoot) || 'Documentation';
  const agents = mergedAgents(intent.agents, draft.agents);
  const candidate = {
    ...intent,
    schemaVersion: 1,
    docType: intent.docType ?? 'external-library',
    personas: intent.personas !== undefined && intent.personas.length > 0 ? intent.personas : [placeholderPersona],
    agents,
    site: { ...intent.site, title: intent.site?.title?.trim() || fallbackTitle }
  };
  const result = docstubeConfigSchema.safeParse(candidate);
  if (result.success) {
    return result.data;
  }
  // A draft the UI wrote in a shape this build no longer understands must not brick setup: fall
  // back to the minimum the transport factory needs, keeping the provider choice.
  return docstubeConfigSchema.parse({
    schemaVersion: 1,
    docType: 'external-library',
    personas: [placeholderPersona],
    agents: mergedAgents(undefined, draft.agents),
    site: { title: fallbackTitle }
  });
};

export type SetupConfigSource = 'committed' | 'draft';
export type SetupConfigResolution = { config: DocstubeConfig; source: SetupConfigSource };

// THE CIRCULARITY FIX. Committed config wins whenever it exists; otherwise setup's agent-backed
// steps run on the draft. An INVALID committed config still throws — a broken docstube.yml is the
// user's to fix, and silently running on a draft instead would hide it.
export const resolveSetupConfig = async (repoRoot: string): Promise<SetupConfigResolution> => {
  try {
    const family = await loadConfigFamily(repoRoot);
    return { config: family.config, source: 'committed' };
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'config-missing') {
      throw error;
    }
  }
  const draft = await readOnboardingDraft(repoRoot);
  if (draft === undefined) {
    throw new CoreError(
      'config-missing',
      'docstube.yml not found and no onboarding draft exists — run `docstube` to start setup',
      { repoRoot }
    );
  }
  return { config: draftSetupConfig(draft, repoRoot), source: 'draft' };
};

export type SetupStatus = {
  hasConfig: boolean;
  // Set when docstube.yml exists but the family does not load (invalid YAML/schema, missing ia.yml).
  configProblem?: string;
  draft: OnboardingDraft | undefined;
  // The surface the UI opens on. Server-decided so the client never guesses.
  initialSurface: 'setup' | 'dashboard';
};

export const readSetupStatus = async (repoRoot: string): Promise<SetupStatus> => {
  const draft = await readOnboardingDraft(repoRoot);
  try {
    await loadConfigFamily(repoRoot);
    return { hasConfig: true, draft, initialSurface: 'dashboard' };
  } catch (error) {
    if (error instanceof CoreError && error.code === 'config-missing') {
      return { hasConfig: false, draft, initialSurface: 'setup' };
    }
    if (error instanceof CoreError && error.code === 'config-invalid') {
      // The files exist but do not load: setup is the surface that can repair them.
      return {
        hasConfig: true,
        configProblem: error.message,
        draft,
        initialSurface: 'setup'
      };
    }
    throw error;
  }
};
