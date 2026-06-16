import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from '@docstube/contracts';

export type BuiltInSkillId =
  | 'component-reference'
  | 'd2-authoring'
  | 'editor'
  | 'reviewer'
  | 'verifier'
  | 'writer'
  | 'writing-conventions';

export const builtInSkillIds = [
  'writer',
  'reviewer',
  'verifier',
  'editor',
  'component-reference',
  'd2-authoring',
  'writing-conventions'
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
    '- Write source-grounded MDX pages from the supplied page brief and codemap facts.',
    '- Use only registered theme components and valid section markers.',
    '- Do not invent APIs, file paths, examples, or capabilities that are not grounded in source facts.',
    `- ${codeWinsRule}`
  ]),
  skill('reviewer', 'docstube Reviewer', [
    '- Review generated pages for persona fit, missing assumptions, and source-grounding risk.',
    '- Return structured findings with concrete page or section references.',
    '- Do not assign numeric quality scores.',
    `- ${codeWinsRule}`
  ]),
  skill('verifier', 'docstube Verifier', [
    '- Prefer deterministic checks over judgement.',
    '- Validate MDX, snippets, imports, links, D2, glossary usage, and API references before approving content.',
    '- Emit structured findings only; never silently fix source facts.',
    `- ${codeWinsRule}`
  ]),
  skill('editor', 'docstube Editor', [
    '- Apply requested feedback narrowly and preserve verified facts.',
    '- Route lasting writing preferences to instructions, criteria, glossary, or config updates.',
    '- Do not rewrite unrelated generated pages.',
    `- ${codeWinsRule}`
  ]),
  skill('component-reference', 'docstube Component Reference', [
    '- Use Callout for notes, warnings, and risk callouts.',
    '- Use Steps for ordered workflows and Terminal or CodeBlock for commands.',
    '- Use Diagram only for D2-backed diagrams rendered by the build integration.',
    '- Screenshot is reserved and must not be used until screenshot capture is designed.'
  ]),
  skill('d2-authoring', 'docstube D2 Authoring', [
    '- Mermaid is not supported.',
    '- D2 diagrams should be small, labelled, and sketch-rendered by default.',
    '- Run the deterministic D2 check before considering a diagram done.',
    '- Prefer semantic node labels over decorative layout tuning.'
  ]),
  skill('writing-conventions', 'docstube Writing Conventions', [
    '- Prefer specific nouns, repo-relative paths, and verifiable claims.',
    '- Keep sections scannable and avoid marketing copy inside generated docs.',
    '- Explain tradeoffs when the source code shows meaningful alternatives.',
    `- ${codeWinsRule}`
  ])
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
        code: 'reference-doc-drift',
        severity: 'major',
        origin: 'verifier',
        message: `Reference doc disagrees with code-grounded fact "${claim.id}". Code wins this conflict.`,
        location: { path: claim.sourcePath },
        meta: {
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
