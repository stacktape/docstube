import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from '@docstube/contracts';
import { pluginAuthoringSkillBody } from './skill-plugin-authoring.ts';

// Re-exported so `docstube plugin scaffold` can write starter files from the same single source
// of truth the plugin-authoring skill embeds.
export {
  examplePackageJsonSource,
  examplePluginManifest,
  examplePluginSource,
  exampleSpecSource
} from './plugin-authoring-example.ts';

export type BuiltInSkillId = 'plugin-authoring' | 'reviewer' | 'writer' | 'writing-conventions';

export const builtInSkillIds = [
  'writer',
  'reviewer',
  'writing-conventions',
  'plugin-authoring'
] as const satisfies readonly BuiltInSkillId[];

export type BuiltInSkillDefinition = {
  content: string;
  id: BuiltInSkillId;
  title: string;
};

const codeWinsRule =
  'When reference docs disagree with code-grounded facts, report the drift and treat code as authoritative.';

const skill = (id: BuiltInSkillId, title: string, body: readonly string[]): BuiltInSkillDefinition => ({
  id,
  title,
  content: [`# ${title}`, '', ...body, ''].join('\n')
});

export const builtInSkills = [
  skill('writer', 'docstube Writer', [
    'You produce documentation where every claim is mechanically verified afterwards. Anything you',
    'assert that the code does not support will be caught and rejected, so never invent behavior.',
    '',
    '## Hard rules',
    '',
    '- Read the actual source with the provided tools before describing behavior. Base every claim on',
    '  code you read, not on what similar projects usually do.',
    '- Output pure MDX: frontmatter with `title` and `description`, then content. Exactly one H1.',
    '  No entity ids, no HTML comments.',
    '- Never write `import`/`export` statements and never set a `layout` frontmatter key — the site',
    '  build provides both.',
    '- Use only the MDX components the task lists as enabled. If none are enabled, use plain',
    '  Markdown/MDX primitives only.',
    '- Code examples must be complete and correct — they are compiled and executed by verifiers.',
    '- Use glossary terms exactly as defined and never use a term\'s listed "avoid" words.',
    '- If something cannot be known from the code (intent, history, "why"), write what IS knowable',
    '  and say nothing else. Do not speculate to fill a section.',
    '',
    '## Retries',
    '',
    'When a draft fails the gate you receive the findings. Fix every finding; change nothing that was',
    'not flagged.',
    '',
    codeWinsRule
  ]),
  skill('reviewer', 'docstube Reviewer', [
    'You review a generated page while embodying exactly one persona. Judge the page only through',
    'that persona: their assumed knowledge, their terminology, their task.',
    '',
    '## Criteria outcomes',
    '',
    '- Apply every criterion you are given and report an explainable outcome for each one:',
    '  `met`, `not-met`, or `not-applicable`, with 1-3 sentences of reasoning grounded in the page text.',
    '- The default criteria are audience-fit (depth and terminology match the persona),',
    '  correctness-risk (concrete claims are plausible given the source context; anything that smells',
    '  invented is a finding), and brief-conformance (the page delivers what its brief promises).',
    '- Never assign numeric quality scores — outcomes plus reasoning only.',
    '',
    '## Findings',
    '',
    '- Emit one finding per concrete problem, with `source: review` and `check` set to the criterion',
    '  name (e.g. `audience-fit`).',
    '- Severity `error` only when the page would mislead or block this persona; otherwise `warning`.',
    '  Error findings send the page back for a bounded rewrite, so reserve them for real blockers.',
    '- Never rewrite the page yourself, and never invent facts about the codebase; judge only what is',
    '  in front of you. Guarantees are assigned by deterministic verifiers, never by review.',
    '',
    codeWinsRule
  ]),
  skill('writing-conventions', 'docstube Writing Conventions', [
    'Prose conventions for generated docs. Deterministic prose lints enforce the mechanical parts;',
    'write so they have nothing to find.',
    '',
    '## Substance',
    '',
    '- Prefer specific nouns, repo-relative paths, exact command names, and verifiable claims over',
    '  abstractions.',
    '- No marketing copy inside docs. State what the code does; explain tradeoffs when the source',
    '  shows meaningful alternatives.',
    '- Lead each section with the thing the reader came for, not with context-setting throat-clearing.',
    '',
    '## Anti-slop',
    '',
    '- Banned AI-isms: "delve", "leverage" (as a verb), "seamless", "seamlessly", "robust",',
    '  "cutting-edge", "comprehensive", "crucial", "empower", "unlock", "streamline", "dive into",',
    '  "it\'s important to note", "it\'s worth noting", "in today\'s fast-paced world", and',
    '  "whether you\'re a X or a Y" framings.',
    '- Vary sentence length and openings. Never start three consecutive sentences with the same word,',
    '  and do not let every paragraph settle into the same three-sentence rhythm.',
    '- Avoid reflexive rule-of-three lists ("fast, simple, and reliable"); enumerate only when each',
    '  item carries verifiable content.',
    '- Use active voice and address the reader as "you" in instructions.',
    '',
    codeWinsRule
  ]),
  skill('plugin-authoring', 'docstube Plugin Authoring', pluginAuthoringSkillBody)
] as const satisfies readonly BuiltInSkillDefinition[];

const builtInSkillMap = new Map<BuiltInSkillId, BuiltInSkillDefinition>(
  builtInSkills.map((definition) => [definition.id, definition])
);

export const skillOwnershipMarker = (id: BuiltInSkillId): string => `<!-- docstube:generated-skill id="${id}" -->`;

export const skillUserEditedMarker = '<!-- docstube:user-edited -->';

export type MaterializedSkillStatus = 'preserved' | 'written';

export type MaterializedSkill = {
  id: BuiltInSkillId;
  path: string;
  status: MaterializedSkillStatus;
};

export type MaterializeSkillsOptions = {
  preserveUserEdits?: boolean;
  skillIds?: readonly BuiltInSkillId[];
  targetDir: string;
};

const skillFileContent = (definition: BuiltInSkillDefinition): string =>
  [skillOwnershipMarker(definition.id), '', definition.content].join('\n');

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const ensureParentDir = async (path: string) => {
  await mkdir(dirname(path), { recursive: true });
};

export const materializeBuiltInSkills = async (options: MaterializeSkillsOptions): Promise<MaterializedSkill[]> => {
  const preserveUserEdits = options.preserveUserEdits ?? true;
  const skillIds = options.skillIds ?? builtInSkillIds;

  return Promise.all(
    skillIds.map(async (id): Promise<MaterializedSkill> => {
      const definition = builtInSkillMap.get(id);
      if (!definition) {
        throw new Error(`Unknown built-in skill: ${id}`);
      }

      const targetPath = join(options.targetDir, id, 'SKILL.md');
      const nextContent = skillFileContent(definition);
      if (preserveUserEdits && (await pathExists(targetPath))) {
        const existing = await readFile(targetPath, 'utf8');
        const generated = existing.includes(skillOwnershipMarker(id));
        const userEdited = existing.includes(skillUserEditedMarker);
        if (!generated || userEdited) {
          return { id, path: targetPath, status: 'preserved' };
        }
      }

      await ensureParentDir(targetPath);
      await writeFile(targetPath, nextContent, 'utf8');
      return { id, path: targetPath, status: 'written' };
    })
  );
};

export type SourceDigest = {
  algorithm: 'sha256';
  value: string;
};

export type SourceRedaction = {
  kind: 'credential' | 'secret';
  label: string;
};

export type LoadedSourceDocument = {
  content: string;
  digest: SourceDigest;
  path: string;
  redactions: SourceRedaction[];
  sourceKind: 'file';
};

export type LoadPathSourcesOptions = {
  paths: readonly string[];
  rootDir: string;
};

const ignoredSourceDirs = new Set(['.git', '.docstube', 'dist', 'node_modules']);

const credentialPattern = /\bsk-[A-Za-z0-9_-]{20,}\b/gu;

const secretAssignmentPattern = /\b(api[_-]?key|password|secret|token)\b\s*[:=]\s*["']?([^\s"',]+)/giu;

const sha256 = (value: string): SourceDigest => ({
  algorithm: 'sha256',
  value: createHash('sha256').update(value).digest('hex')
});

const redactSecrets = (content: string): { content: string; redactions: SourceRedaction[] } => {
  const redactions: SourceRedaction[] = [];
  let redacted = content.replaceAll(credentialPattern, () => {
    redactions.push({ kind: 'credential', label: 'openai-key' });
    return '[REDACTED]';
  });

  redacted = redacted.replaceAll(secretAssignmentPattern, (...args: unknown[]) => {
    const match = typeof args[0] === 'string' ? args[0] : '';
    const key = typeof args[1] === 'string' ? args[1] : undefined;
    const value = typeof args[2] === 'string' ? args[2] : '';
    if (value.includes('[REDACTED]')) {
      return match;
    }

    redactions.push({ kind: 'secret', label: 'assignment' });
    return key ? `${key}=[REDACTED]` : '[REDACTED]';
  });

  return { content: redacted, redactions };
};

const loadFileSource = async (rootDir: string, filePath: string): Promise<LoadedSourceDocument> => {
  const rawContent = await readFile(filePath, 'utf8');
  const redacted = redactSecrets(rawContent);
  const path = normalizeSourcePath(relative(rootDir, filePath));
  return {
    path,
    content: redacted.content,
    redactions: redacted.redactions,
    digest: sha256(`${path}\n${redacted.content}`),
    sourceKind: 'file'
  };
};

const normalizeSourcePath = (path: string): string => path.replaceAll('\\', '/');

const collectSourceFiles = async (path: string): Promise<string[]> => {
  const info = await stat(path);
  if (info.isFile()) {
    return [path];
  }
  if (!info.isDirectory()) {
    return [];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      if (entry.isDirectory() && ignoredSourceDirs.has(entry.name)) {
        return [];
      }
      return collectSourceFiles(join(path, entry.name));
    })
  );
  return files.flat();
};

export const loadPathSources = async (options: LoadPathSourcesOptions): Promise<LoadedSourceDocument[]> => {
  const files = (
    await Promise.all(options.paths.map((sourcePath) => collectSourceFiles(join(options.rootDir, sourcePath))))
  )
    .flat()
    .toSorted((left, right) => left.localeCompare(right));

  return Promise.all(files.map((filePath) => loadFileSource(options.rootDir, filePath)));
};

export type GitSourceReference = {
  digest: SourceDigest;
  kind: 'git';
  ref?: string;
  url: string;
};

const sanitizeGitUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    const scpLike = /^(?:[^@]+@)?([^:]+):(.+)$/u.exec(value);
    if (scpLike) {
      return `ssh://${scpLike[1]}/${scpLike[2]}`;
    }
    throw new Error(`Invalid git source URL: ${value}`);
  }
};

export const createGitSourceReference = (input: { ref?: string; url: string }): GitSourceReference => {
  const safeUrl = sanitizeGitUrl(input.url);
  return {
    kind: 'git',
    url: safeUrl,
    ref: input.ref,
    digest: sha256(`git\n${safeUrl}\n${input.ref ?? ''}`)
  };
};

export type McpSourceReference = {
  digest: SourceDigest;
  kind: 'mcp';
  resourceUri?: string;
  server: string;
};

export const createMcpSourceReference = (input: { resourceUri?: string; server: string }): McpSourceReference => ({
  kind: 'mcp',
  server: input.server,
  resourceUri: input.resourceUri,
  digest: sha256(`mcp\n${input.server}\n${input.resourceUri ?? ''}`)
});

export type CodeGroundedFact = {
  id: string;
  sourcePath: string;
  statement: string;
};

export type ReferenceDocClaim = {
  id: string;
  sourcePath: string;
  statement: string;
};

export type DriftReport = {
  findings: Finding[];
};

export const createDriftReport = (input: {
  codeFacts: readonly CodeGroundedFact[];
  referenceClaims: readonly ReferenceDocClaim[];
}): DriftReport => {
  const factsById = new Map(input.codeFacts.map((fact) => [fact.id, fact]));
  const findings: Finding[] = [];

  for (const claim of input.referenceClaims) {
    const fact = factsById.get(claim.id);
    if (fact && fact.statement !== claim.statement) {
      findings.push({
        source: 'verifier',
        check: 'reference-doc-drift',
        severity: 'error',
        message: `Reference doc disagrees with code-grounded fact "${claim.id}". Code wins this conflict.`,
        file: claim.sourcePath,
        data: {
          codeFact: fact.statement,
          codeSourcePath: fact.sourcePath,
          referenceClaim: claim.statement
        }
      });
    }
  }

  return { findings };
};

export const skillsPackageDir = fileURLToPath(new URL('..', import.meta.url));
