import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path/posix';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { findingSchema, generatedPageFrontmatterSchema } from '@docstube/contracts';
import type { CheckResult, Finding, GeneratedPageFrontmatter, Timestamp } from '@docstube/contracts';
import type { AgentAdapter, AgentRunInput, AgentTextArtifact } from '@docstube/agent';
import type { GeneratedMdxPage } from '@docstube/verifiers';
import { runCachedAgentStep, runRetryLoop, writeAgentTranscript } from './pipeline-artifacts.ts';
import type { AgentCacheKeyInput } from './pipeline-artifacts.ts';
import type { PageGenerationContext } from './page-generation-context.ts';
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
  cacheDir?: string;
  context?: PageGenerationContext;
  maxRetries?: number;
  model?: string;
  now?: () => Timestamp;
  page: ScheduledPage;
  repoRoot: string;
  reviewers: readonly PersonaReviewer[];
  runId: string;
  transcriptRunDir?: string;
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

const writableRootForPage = (repoRoot: string, page: ScheduledPage): string => resolve(repoRoot, dirname(page.slug));

const promptList = (title: string, values: readonly string[], empty: string): string[] => [
  title,
  ...(values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${empty}`])
];

const sourceContextPrompt = (context: PageGenerationContext | undefined): string[] => {
  if (!context) {
    return ['Grounding context: none supplied.'];
  }

  return [
    ...promptList(
      'Source-grounded facts:',
      context.sourceFacts.slice(0, 24),
      'No configured source files matched this page.'
    ),
    ...promptList(
      'Allowed theme components:',
      context.componentNames.map((name) => `\`${name}\``),
      'No theme components configured.'
    ),
    ...promptList(
      'Available API symbols:',
      context.apiSymbols.slice(0, 24).map((symbol) => `${symbol.name} (${symbol.kind}) from ${symbol.sourcePath}`),
      'No API symbols extracted for this page.'
    ),
    ...promptList(
      'Glossary terms:',
      context.glossaryTerms
        .slice(0, 24)
        .map((term) => `${term.id}: ${term.term}${term.aliases.length > 0 ? ` (${term.aliases.join(', ')})` : ''}`),
      'No glossary terms configured.'
    ),
    ...promptList('Committed writing instructions:', context.instructions.slice(0, 8), 'No extra instructions.'),
    ...promptList('Committed review criteria:', context.criteria.slice(0, 8), 'No extra criteria.')
  ];
};

const findingsPrompt = (findings: readonly Finding[]): string[] =>
  findings.length === 0
    ? []
    : [
        'Previous findings to fix before returning the page:',
        ...findings.slice(0, 12).map((finding) => `- ${finding.severity} ${finding.code}: ${finding.message}`)
      ];

const sourceDigestMetadata = (context: PageGenerationContext | undefined) =>
  context?.sourceDigests.map((digest) => ({
    algorithm: digest.algorithm,
    path: digest.path,
    value: digest.value
  })) ?? [];

export const createWriterRunInput = (input: {
  context?: PageGenerationContext;
  model?: string;
  page: ScheduledPage;
  previousFindings?: readonly Finding[];
  repoRoot: string;
  runId: string;
}): AgentRunInput => ({
  taskId: safeTaskId('writer', input.page.id),
  model: input.model ?? 'replay-fixture',
  prompt: [
    `Run: ${input.runId}`,
    `Write page ${input.page.id} at repo-relative path ${input.page.slug}.`,
    `Title: ${input.page.title}`,
    input.page.brief ? `Brief: ${input.page.brief}` : 'Brief: none',
    'The file must contain one docstube-generated MDX page with valid frontmatter and section markers.',
    'Use code and committed project context as the source of truth. Do not invent facts that are not grounded below.',
    'When referencing APIs or project behavior, cite the relevant source path or symbol in prose.',
    ...sourceContextPrompt(input.context),
    ...findingsPrompt(input.previousFindings ?? []),
    'If your adapter supports artifacts, also return that MDX artifact.'
  ].join('\n'),
  sandbox: {
    readOnlyRoots: [resolve(input.repoRoot)],
    writableRoots: [writableRootForPage(input.repoRoot, input.page)],
    allowNetwork: false,
    shell: 'none'
  },
  metadata: {
    runId: input.runId,
    pageId: input.page.id,
    pagePath: input.page.slug,
    sourceDigests: sourceDigestMetadata(input.context),
    componentNames: [...(input.context?.componentNames ?? [])],
    apiSymbols: input.context?.apiSymbols.map((symbol) => symbol.name) ?? []
  }
});

export const createReviewerRunInput = (input: {
  artifactContent: string;
  context?: PageGenerationContext;
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
    'Check the page against source facts, committed criteria, glossary, and the persona audience.',
    ...sourceContextPrompt(input.context),
    '',
    input.artifactContent
  ].join('\n'),
  sandbox: {
    readOnlyRoots: [resolve(input.repoRoot)],
    writableRoots: [],
    allowNetwork: false,
    shell: 'none'
  },
  metadata: {
    runId: input.runId,
    pageId: input.page.id,
    personaId: input.personaId,
    sourceDigests: sourceDigestMetadata(input.context)
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

const readGeneratedArtifactFromWorkspace = async (input: {
  page: ScheduledPage;
  repoRoot: string;
}): Promise<AgentTextArtifact | null> => {
  try {
    return {
      path: input.page.slug,
      content: await readFile(resolve(input.repoRoot, input.page.slug), 'utf8'),
      encoding: 'utf8'
    };
  } catch {
    return null;
  }
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

type PageGenerationAttempt = {
  artifact: AgentTextArtifact;
  checkResults: CheckResult[];
  findings: Finding[];
  generatedPage: GeneratedMdxPage;
  reviewerFindings: Finding[];
  verifierFindings: Finding[];
};

const cacheKeyInput = (input: {
  adapter: AgentAdapter;
  context?: PageGenerationContext;
  model: string;
  prompt: string;
}): AgentCacheKeyInput => ({
  adapterId: input.adapter.id,
  adapterVersion: input.adapter.version,
  model: input.model,
  prompt: input.prompt,
  inputDigests: input.context?.sourceDigests ?? []
});

const runAgentStep = async (input: {
  adapter: AgentAdapter;
  cacheDir?: string;
  context?: PageGenerationContext;
  run: () => Promise<Awaited<ReturnType<AgentAdapter['run']>>>;
  runInput: AgentRunInput;
  stepId: string;
  transcriptRunDir?: string;
}) => {
  const result = input.cacheDir
    ? (
        await runCachedAgentStep({
          cacheDir: input.cacheDir,
          cacheKeyInput: cacheKeyInput({
            adapter: input.adapter,
            context: input.context,
            model: input.runInput.model,
            prompt: input.runInput.prompt
          }),
          run: input.run
        })
      ).result
    : await input.run();

  if (input.transcriptRunDir) {
    await writeAgentTranscript({
      runDir: input.transcriptRunDir,
      stepId: input.stepId,
      input: input.runInput,
      result
    });
  }

  return result;
};

const runPageGenerationAttempt = async (input: {
  attempt: number;
  context?: PageGenerationContext;
  model: string;
  options: PageGenerationOptions;
  previousFindings: readonly Finding[];
}): Promise<PageGenerationAttempt> => {
  const writerInput = createWriterRunInput({
    runId: input.options.runId,
    page: input.options.page,
    repoRoot: input.options.repoRoot,
    model: input.model,
    context: input.context,
    previousFindings: input.previousFindings
  });
  const writerResult = await runAgentStep({
    adapter: input.options.writer,
    cacheDir: input.options.cacheDir,
    context: input.context,
    runInput: writerInput,
    stepId: `${writerInput.taskId}-attempt-${input.attempt}`,
    transcriptRunDir: input.options.transcriptRunDir,
    run: () => input.options.writer.run(writerInput)
  });
  if (writerResult.status === 'failed') {
    throw new PageGenerationError(writerResult.error);
  }

  const artifact =
    writerResult.artifacts.find((candidate) => candidate.path === input.options.page.slug) ??
    (await readGeneratedArtifactFromWorkspace({ repoRoot: input.options.repoRoot, page: input.options.page }));
  if (!artifact) {
    throw new PageGenerationError(`writer did not produce expected artifact: ${input.options.page.slug}`);
  }

  const generatedPage = splitGeneratedPageArtifact(artifact);
  const reviewerResults = await Promise.all(
    input.options.reviewers.map(async (reviewer) => {
      const reviewerInput = createReviewerRunInput({
        runId: input.options.runId,
        page: input.options.page,
        repoRoot: input.options.repoRoot,
        personaId: reviewer.personaId,
        artifactContent: artifact.content,
        model: input.model,
        context: input.context
      });
      const result = await runAgentStep({
        adapter: reviewer.adapter,
        cacheDir: input.options.cacheDir,
        context: input.context,
        runInput: reviewerInput,
        stepId: `${reviewerInput.taskId}-attempt-${input.attempt}`,
        transcriptRunDir: input.options.transcriptRunDir,
        run: () => reviewer.adapter.run(reviewerInput)
      });
      return result.status === 'completed' ? reviewerFindingsFromOutput(result.output) : [];
    })
  );
  const checkResults = await Promise.all(input.options.verifiers.map((verifier) => verifier.run(generatedPage)));
  const reviewerFindings = mergeFindings(...reviewerResults);
  const verifierFindings = mergeFindings(checkResults.flatMap(checkResultFindings));
  const findings = mergeFindings(reviewerFindings, verifierFindings);

  return {
    artifact,
    generatedPage,
    checkResults,
    reviewerFindings,
    verifierFindings,
    findings
  };
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

  const retryResult = await runRetryLoop({
    maxRetries: options.maxRetries ?? 0,
    runAttempt: async (attempt, previousFindings) => {
      if (attempt > 0) {
        await options.backend.upsertPage({
          id: options.page.id,
          runId: options.runId,
          title: options.page.title,
          slug: options.page.slug,
          status: 'retrying',
          approved: false,
          findings: [...previousFindings],
          updatedAt: now()
        });
      }

      const attemptResult = await runPageGenerationAttempt({
        attempt,
        context: options.context,
        model,
        options,
        previousFindings
      });

      return attemptResult.findings.length === 0
        ? { status: 'passed', value: attemptResult }
        : { status: 'retry', findings: attemptResult.findings, value: attemptResult };
    }
  });
  if (!retryResult.value) {
    throw new PageGenerationError(`page generation failed without an artifact: ${options.page.slug}`);
  }

  const { artifact, generatedPage, checkResults, reviewerFindings, verifierFindings, findings } = retryResult.value;

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
