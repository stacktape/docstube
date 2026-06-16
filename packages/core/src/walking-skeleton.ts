import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { buildSectionMarker, generatedPageFrontmatterSchema, relativePathSchema } from '@docstube/contracts';
import type { CheckResult, GeneratedPageFrontmatter, RelativePath, Timestamp } from '@docstube/contracts';
import type { AgentAdapter, AgentReplayFixture, AgentRunInput, AgentTextArtifact } from '@docstube/agent';
import { agentTextArtifactSchema } from '@docstube/agent';
import { checkGeneratedPageSections, compileGeneratedMdxPageToHtml } from '@docstube/verifiers';
import type { GeneratedMdxPage } from '@docstube/verifiers';
import type { PageDetail, RunRecord, StateBackend } from './state-backend';

export const walkingSkeletonTaskId = 's0-walking-skeleton';
export const walkingSkeletonRunId = 'run-s0-walking-skeleton';
export const walkingSkeletonOutputPath = 'docs/overview.mdx';
export const walkingSkeletonSourcePath = 'src/toolkit.ts';
export const walkingSkeletonHtmlToken = 'DOCSTUBE_S0_WALKING_SKELETON_TOKEN';

export type WalkingSkeletonOptions = {
  repoRoot: string;
  backend: StateBackend;
  adapter: AgentAdapter;
  now?: () => Timestamp;
  sourcePath?: RelativePath;
  outputPath?: RelativePath;
};

export type WalkingSkeletonResult = {
  input: AgentRunInput;
  page: PageDetail;
  checkResult: CheckResult;
  html: string;
  artifactPath: RelativePath;
};

export class WalkingSkeletonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalkingSkeletonError';
  }
}

const defaultTimestamp = '2026-06-16T00:00:00.000Z';

const toNativePath = (path: RelativePath): string => path.split('/').join(sep);

const resolveRepoPath = (repoRoot: string, path: RelativePath): string => {
  const root = resolve(repoRoot);
  const target = resolve(root, toNativePath(path));
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;

  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new WalkingSkeletonError(`artifact path escaped repo root: ${path}`);
  }

  return target;
};

export const createWalkingSkeletonInput = async (
  repoRoot: string,
  sourcePath: RelativePath = walkingSkeletonSourcePath,
  outputPath: RelativePath = walkingSkeletonOutputPath
): Promise<AgentRunInput> => {
  const parsedSourcePath = relativePathSchema.parse(sourcePath);
  const parsedOutputPath = relativePathSchema.parse(outputPath);
  const source = await readFile(resolveRepoPath(repoRoot, parsedSourcePath), 'utf8');

  return {
    taskId: walkingSkeletonTaskId,
    model: 'replay-fixture',
    prompt: [
      `Generate ${parsedOutputPath} for this fixture repository.`,
      `Use the source facts from ${parsedSourcePath}.`,
      'Return a docstube-generated MDX page with an overview intro section.',
      '',
      source
    ].join('\n'),
    sandbox: {
      readOnlyRoots: [resolve(repoRoot)],
      writableRoots: [resolveRepoPath(repoRoot, 'docs')],
      allowNetwork: false,
      shell: 'none'
    }
  };
};

const splitGeneratedPageArtifact = (artifact: AgentTextArtifact): GeneratedMdxPage => {
  const parsedArtifact = agentTextArtifactSchema.parse(artifact);
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?(?<body>[\s\S]*)$/u.exec(parsedArtifact.content);

  if (!match?.groups) {
    throw new WalkingSkeletonError(`generated artifact is missing frontmatter: ${parsedArtifact.path}`);
  }

  const frontmatterText = match.groups.frontmatter;
  const body = match.groups.body;
  if (typeof frontmatterText !== 'string' || typeof body !== 'string') {
    throw new WalkingSkeletonError(`generated artifact has malformed frontmatter: ${parsedArtifact.path}`);
  }

  const document = parseDocument(frontmatterText);
  if (document.errors.length > 0) {
    throw new WalkingSkeletonError(`generated artifact has invalid frontmatter: ${parsedArtifact.path}`);
  }

  const frontmatter = generatedPageFrontmatterSchema.parse(document.toJS()) as GeneratedPageFrontmatter;
  return { path: parsedArtifact.path, frontmatter, body };
};

const writeArtifact = async (repoRoot: string, artifact: AgentTextArtifact): Promise<void> => {
  const parsed = agentTextArtifactSchema.parse(artifact);
  const target = resolveRepoPath(repoRoot, parsed.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, parsed.content, 'utf8');
};

export const runS0WalkingSkeleton = async (options: WalkingSkeletonOptions): Promise<WalkingSkeletonResult> => {
  const now = options.now ?? (() => defaultTimestamp);
  const sourcePath = relativePathSchema.parse(options.sourcePath ?? walkingSkeletonSourcePath);
  const outputPath = relativePathSchema.parse(options.outputPath ?? walkingSkeletonOutputPath);
  const input = await createWalkingSkeletonInput(options.repoRoot, sourcePath, outputPath);

  const startedRun: RunRecord = {
    id: walkingSkeletonRunId,
    status: 'running',
    capFrozen: false,
    startedAt: now(),
    updatedAt: now()
  };
  await options.backend.saveRun(startedRun);

  const result = await options.adapter.run(input);
  if (result.status === 'failed') {
    await options.backend.saveRun({ ...startedRun, status: 'failed', note: result.error, updatedAt: now() });
    throw new WalkingSkeletonError(result.error);
  }

  const artifact = result.artifacts.find((candidate) => candidate.path === outputPath);
  if (!artifact) {
    await options.backend.saveRun({
      ...startedRun,
      status: 'failed',
      note: `missing generated artifact: ${outputPath}`,
      updatedAt: now()
    });
    throw new WalkingSkeletonError(`missing generated artifact: ${outputPath}`);
  }

  await writeArtifact(options.repoRoot, artifact);

  const generatedPage = splitGeneratedPageArtifact(artifact);
  const checkResult = checkGeneratedPageSections(generatedPage);
  const html = await compileGeneratedMdxPageToHtml(generatedPage);
  const findings = checkResult.status === 'failed' ? checkResult.findings : [];
  const status = checkResult.status === 'passed' ? 'passed' : 'flagged';

  const page = await options.backend.upsertPage({
    id: generatedPage.frontmatter.id,
    runId: walkingSkeletonRunId,
    title: generatedPage.frontmatter.title,
    slug: generatedPage.frontmatter.id,
    status,
    approved: false,
    findings,
    updatedAt: now()
  });

  await options.backend.saveRun({
    ...startedRun,
    status: status === 'passed' ? 'completed' : 'failed',
    updatedAt: now()
  });

  return {
    input,
    page,
    checkResult,
    html,
    artifactPath: artifact.path
  };
};

export const createS0WalkingSkeletonReplayFixture = async (repoRoot: string): Promise<AgentReplayFixture> => {
  const input = await createWalkingSkeletonInput(repoRoot);
  const content = [
    '---',
    'id: overview',
    'title: Overview',
    'sections:',
    '  - intro',
    'generated:',
    '  by: docstube',
    '  version: 0.0.2',
    "  at: '2026-06-16T00:00:00.000Z'",
    '---',
    buildSectionMarker('start', 'intro'),
    '',
    '## Overview',
    '',
    `The fixture toolkit renders ${walkingSkeletonHtmlToken}.`,
    '',
    buildSectionMarker('end', 'intro')
  ].join('\n');

  return {
    version: 1,
    name: walkingSkeletonTaskId,
    recordedAt: defaultTimestamp,
    input,
    result: {
      adapterId: 'replay',
      adapterVersion: '0.0.0',
      status: 'completed',
      startedAt: defaultTimestamp,
      completedAt: defaultTimestamp,
      events: [
        {
          type: 'run-started',
          sequence: 0,
          timestamp: defaultTimestamp,
          adapterId: 'replay',
          adapterVersion: '0.0.0',
          model: input.model,
          sandbox: input.sandbox
        },
        {
          type: 'artifact-written',
          sequence: 1,
          timestamp: defaultTimestamp,
          path: walkingSkeletonOutputPath,
          bytes: content.length
        },
        {
          type: 'run-completed',
          sequence: 2,
          timestamp: defaultTimestamp,
          exitCode: 0
        }
      ],
      artifacts: [{ path: walkingSkeletonOutputPath, content, encoding: 'utf8' }]
    }
  };
};
