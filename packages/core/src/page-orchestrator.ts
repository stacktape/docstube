import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { findingSchema, generatedPageFrontmatterSchema } from '@docstube/contracts';
import type { CheckResult, Finding, GeneratedPageFrontmatter, Timestamp } from '@docstube/contracts';
import type { AgentAdapter, AgentRunInput, AgentTextArtifact } from '@docstube/agent';
import type { GeneratedMdxPage } from '@docstube/verifiers';
import type { ScheduledPage } from './pipeline-run.ts';
import type { PageDetail, StateBackend } from './state-backend.ts';

export type PersonaReviewer = {
  adapter: AgentAdapter;
  personaId: string;
};

export type PageDeterministicVerifier = {
  id: string;
  run: (page: GeneratedMdxPage) => CheckResult | Promise<CheckResult>;
};

export type PageGenerationOptions = {
  backend: StateBackend;
  model?: string;
  now?: () => Timestamp;
  page: ScheduledPage;
  repoRoot: string;
  reviewers: readonly PersonaReviewer[];
  runId: string;
  verifiers: readonly PageDeterministicVerifier[];
  writer: AgentAdapter;
};

export type PageGenerationResult = {
  artifact: AgentTextArtifact;
  checkResults: CheckResult[];
  generatedPage: GeneratedMdxPage;
  page: PageDetail;
  reviewerFindings: Finding[];
  verifierFindings: Finding[];
};

export class PageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageGenerationError';
  }
}

const defaultTimestamp = '2026-06-16T00:00:00.000Z';

const safeTaskId = (prefix: string, pageId: string): string => `${prefix}-${pageId.replaceAll('/', '-')}`;

const docsRoot = (repoRoot: string): string => resolve(repoRoot, 'docs');

export const createWriterRunInput = (input: {
  model?: string;
  page: ScheduledPage;
  repoRoot: string;
  runId: string;
}): AgentRunInput => ({
  taskId: safeTaskId('writer', input.page.id),
  model: input.model ?? 'replay-fixture',
  prompt: [
    `Run: ${input.runId}`,
    `Write page ${input.page.id} at ${input.page.slug}.`,
    `Title: ${input.page.title}`,
    input.page.brief ? `Brief: ${input.page.brief}` : 'Brief: none',
    'Return one docstube-generated MDX artifact.'
  ].join('\n'),
  sandbox: {
    readOnlyRoots: [resolve(input.repoRoot)],
    writableRoots: [docsRoot(input.repoRoot)],
    allowNetwork: false,
    shell: 'none'
  }
});

export const createReviewerRunInput = (input: {
  artifactContent: string;
  model?: string;
  page: ScheduledPage;
  personaId: string;
  repoRoot: string;
  runId: string;
}): AgentRunInput => ({
  taskId: safeTaskId(`reviewer-${input.personaId}`, input.page.id),
  model: input.model ?? 'replay-fixture',
  prompt: [
    `Run: ${input.runId}`,
    `Review page ${input.page.id} for persona ${input.personaId}.`,
    'Return JSON findings only.',
    '',
    input.artifactContent
  ].join('\n'),
  sandbox: {
    readOnlyRoots: [resolve(input.repoRoot)],
    writableRoots: [],
    allowNetwork: false,
    shell: 'none'
  }
});

const splitGeneratedPageArtifact = (artifact: AgentTextArtifact): GeneratedMdxPage => {
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?(?<body>[\s\S]*)$/u.exec(artifact.content);
  if (!match?.groups) {
    throw new PageGenerationError(`generated artifact is missing frontmatter: ${artifact.path}`);
  }

  const frontmatterText = match.groups.frontmatter;
  const body = match.groups.body;
  if (typeof frontmatterText !== 'string' || typeof body !== 'string') {
    throw new PageGenerationError(`generated artifact has malformed frontmatter: ${artifact.path}`);
  }

  const document = parseDocument(frontmatterText);
  if (document.errors.length > 0) {
    throw new PageGenerationError(`generated artifact has invalid frontmatter: ${artifact.path}`);
  }

  const frontmatter = generatedPageFrontmatterSchema.parse(document.toJS()) as GeneratedPageFrontmatter;
  return { path: artifact.path, frontmatter, body };
};

const reviewerOutputSchema = z.union([
  z.array(findingSchema),
  z.strictObject({
    findings: z.array(findingSchema).default([])
  })
]);

const reviewerFindingsFromOutput = (output: unknown): Finding[] => {
  const parsed = reviewerOutputSchema.safeParse(output);
  if (!parsed.success) {
    return [];
  }
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.findings;
};

const checkResultFindings = (result: CheckResult): Finding[] => {
  if (result.status === 'failed') {
    return result.findings;
  }
  if (result.status === 'errored') {
    return [
      {
        code: 'verifier-error',
        severity: 'major',
        origin: 'verifier',
        message: result.error,
        meta: { checkId: result.checkId }
      }
    ];
  }
  return [];
};

const findingKey = (finding: Finding): string =>
  JSON.stringify({
    code: finding.code,
    message: finding.message,
    pageId: finding.pageId,
    sectionId: finding.sectionId,
    location: finding.location
  });

export const mergeFindings = (...groups: readonly Finding[][]): Finding[] => {
  const merged = new Map<string, Finding>();
  for (const finding of groups.flat()) {
    const key = findingKey(finding);
    if (!merged.has(key)) {
      merged.set(key, finding);
    }
  }
  return [...merged.values()];
};

export const runReplayPageGeneration = async (options: PageGenerationOptions): Promise<PageGenerationResult> => {
  const now = options.now ?? (() => defaultTimestamp);
  const model = options.model ?? 'replay-fixture';

  await options.backend.upsertPage({
    id: options.page.id,
    runId: options.runId,
    title: options.page.title,
    slug: options.page.slug,
    status: 'running',
    approved: false,
    findings: [],
    updatedAt: now()
  });

  const writerResult = await options.writer.run(
    createWriterRunInput({ runId: options.runId, page: options.page, repoRoot: options.repoRoot, model })
  );
  if (writerResult.status === 'failed') {
    throw new PageGenerationError(writerResult.error);
  }

  const artifact = writerResult.artifacts.find((candidate) => candidate.path === options.page.slug);
  if (!artifact) {
    throw new PageGenerationError(`writer did not produce expected artifact: ${options.page.slug}`);
  }

  const generatedPage = splitGeneratedPageArtifact(artifact);
  const reviewerResults = await Promise.all(
    options.reviewers.map(async (reviewer) => {
      const result = await reviewer.adapter.run(
        createReviewerRunInput({
          runId: options.runId,
          page: options.page,
          repoRoot: options.repoRoot,
          personaId: reviewer.personaId,
          artifactContent: artifact.content,
          model
        })
      );
      return result.status === 'completed' ? reviewerFindingsFromOutput(result.output) : [];
    })
  );
  const checkResults = await Promise.all(options.verifiers.map((verifier) => verifier.run(generatedPage)));
  const reviewerFindings = mergeFindings(...reviewerResults);
  const verifierFindings = mergeFindings(checkResults.flatMap(checkResultFindings));
  const findings = mergeFindings(reviewerFindings, verifierFindings);

  const page = await options.backend.upsertPage({
    id: generatedPage.frontmatter.id,
    runId: options.runId,
    title: generatedPage.frontmatter.title,
    slug: options.page.slug,
    status: findings.length === 0 ? 'passed' : 'flagged',
    approved: false,
    findings,
    updatedAt: now()
  });

  return {
    artifact,
    generatedPage,
    checkResults,
    reviewerFindings,
    verifierFindings,
    page
  };
};
