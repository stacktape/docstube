import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentTaskSpec, ToolDescriptor, Transcript } from '@docstube/contracts';
import { agentTaskSpecSchema, idPrefixes, mintId } from '@docstube/contracts';

// Theme extraction task (PRODUCT §3.9.2 step 7, "Match my existing project"): an agent with the
// standard read tools inspects the repo's Tailwind config / CSS custom properties / design-token
// files and maps what it finds onto the docstube theme token vocabulary. The result lands in the
// same token editor the "Design it here" path uses.

// The docstube theme token vocabulary — mirrors defaultThemeTokens in
// packages/theme/src/emit-site.ts (copied, not imported: core must not depend on the theme
// package). Keep the two lists in sync.
export const themeTokenNames = [
  'surface',
  'surface-muted',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'accent',
  'accent-strong',
  'success',
  'warning',
  'danger',
  'font-family'
] as const;
export type ThemeTokenName = (typeof themeTokenNames)[number];

export const themeTokenExtractionSchema = z.object({
  // Token name -> CSS value ("#0f766e", "1px solid …", a font stack). Only include tokens the
  // project actually defines; omit anything you would have to guess.
  tokens: z.record(z.string(), z.string()),
  // One line on where the tokens came from (file paths), shown in the wizard.
  notes: z.string().optional()
});

// Bounded candidate probe — a hint list for the prompt, never a hard scope. The agent still
// explores with its read tools.
const candidateFiles = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'postcss.config.js',
  'src/index.css',
  'src/app.css',
  'src/styles.css',
  'src/styles/globals.css',
  'app/globals.css',
  'styles/globals.css',
  'design-tokens.json',
  'tokens.json'
] as const;

const probeCandidates = async (repoRoot: string): Promise<string[]> => {
  const found: string[] = [];
  for (const candidate of candidateFiles) {
    try {
      await stat(join(repoRoot, candidate));
      found.push(candidate);
    } catch {
      // absent — not a hint
    }
  }
  return found;
};

const extractSystemPrompt = (): string =>
  [
    'You are the docstube theme extractor. Inspect this repository and extract its visual design tokens so the',
    "generated documentation site can match the project's existing look.",
    '',
    'Look for, in priority order:',
    '- Tailwind configuration (theme.colors, theme.extend, fontFamily) and Tailwind v4 `@theme` blocks in CSS.',
    '- CSS custom properties (`:root { --… }`) in global stylesheets.',
    '- Design-token files (tokens.json, design-tokens.json, style-dictionary sources).',
    '',
    'Map what you find onto EXACTLY these docstube token names (report only the ones the project defines):',
    ...themeTokenNames.map((name) => `- ${name}`),
    '',
    'Rules:',
    '- Values are plain CSS values: hex/rgb/hsl colors, or a full font-family stack for `font-family`.',
    "- Prefer the project's primary brand color for `accent` and a darker shade of it for `accent-strong`.",
    '- Never invent a value: if the project has no signal for a token, omit that token.',
    '- Use `notes` for one line naming the files the tokens came from.'
  ].join('\n');

const extractUserPrompt = (foundCandidates: string[]): string =>
  [
    'Extract the design tokens from this repository.',
    '',
    foundCandidates.length > 0
      ? `Detected candidate files (start here, then explore):\n${foundCandidates.map((file) => `- ${file}`).join('\n')}`
      : 'No obvious token files were detected at common paths — search the repository for stylesheets and theme configuration.'
  ].join('\n');

export type ExtractThemeTokensInput = {
  repoRoot: string;
  // The standard read tools (read_file / list_dir / glob / grep) — injected by the caller so this
  // module stays free of an agent-runtime dependency.
  toolDescriptors: ToolDescriptor[];
};

export const buildExtractThemeTokensTask = async (input: ExtractThemeTokensInput): Promise<AgentTaskSpec> =>
  agentTaskSpecSchema.parse({
    id: mintId(idPrefixes.task),
    kind: 'extract-theme-tokens',
    systemPrompt: extractSystemPrompt(),
    userPrompt: extractUserPrompt(await probeCandidates(input.repoRoot)),
    tools: input.toolDescriptors,
    workspace: { readRoots: ['.'], writableRoots: [] },
    budget: { maxTurns: 12, maxToolCalls: 32 },
    output: {
      type: 'structured',
      jsonSchema: z.toJSONSchema(themeTokenExtractionSchema, { io: 'input', unrepresentable: 'any' })
    }
  });

export type ThemeTokensResult = {
  tokens: Partial<Record<ThemeTokenName, string>>;
  notes?: string | undefined;
  warnings: string[];
};

const isThemeTokenName = (name: string): name is ThemeTokenName =>
  (themeTokenNames as readonly string[]).includes(name);

// Lenient like the review stage: a broken extraction returns empty tokens + a warning; unknown
// token names are dropped (with a warning) instead of failing the whole result.
export const tokensFromTranscript = (transcript: Transcript): ThemeTokensResult => {
  if (transcript.result?.type === 'structured') {
    const parsed = themeTokenExtractionSchema.safeParse(transcript.result.value);
    if (parsed.success) {
      const tokens: Partial<Record<ThemeTokenName, string>> = {};
      const dropped: string[] = [];
      for (const [name, value] of Object.entries(parsed.data.tokens)) {
        if (isThemeTokenName(name)) {
          tokens[name] = value;
        } else {
          dropped.push(name);
        }
      }
      return {
        tokens,
        ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes }),
        warnings: dropped.length > 0 ? [`dropped unknown theme token names: ${dropped.join(', ')}`] : []
      };
    }
  }
  return {
    tokens: {},
    warnings: [
      `theme-extraction task returned no valid tokens (stop: ${transcript.stopReason}); design the theme manually`
    ]
  };
};
