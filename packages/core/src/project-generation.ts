import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dirname as posixDirname, join as posixJoin, relative as posixRelative } from 'node:path/posix';
import {
  createClaudeAdapter,
  createCodexAdapter,
  createDirectApiAdapter,
  createGeminiAdapter,
  createMockAgentAdapter
} from '@docstube/agent';
import { buildSectionMarker } from '@docstube/contracts';
import type { AgentAdapter, AgentTextArtifact } from '@docstube/agent';
import type {
  AgentChoice,
  DocstubeConfig,
  Finding,
  Glossary,
  Manifest,
  ManifestPage,
  PageId,
  RelativePath,
  SectionId,
  Timestamp
} from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations.ts';
import { createPageProvenance, updateManifest, writeManifestFile } from './incremental-engine.ts';
import type { ManifestPageUpdate } from './incremental-engine.ts';
import { createLocalBackend } from './local-backend.ts';
import { createPageGenerationContext, createSourceGroundingContext } from './page-generation-context.ts';
import type { PageGenerationContext } from './page-generation-context.ts';
import { runReplayPageGeneration } from './page-orchestrator.ts';
import type { PersonaReviewer } from './page-orchestrator.ts';
import { freezeRunForCaps, initializeRunFromConfigFamily, transitionRunStatus } from './pipeline-run.ts';
import type { ScheduledPage } from './pipeline-run.ts';
import { createProjectPageVerifiers } from './page-verifier-gate.ts';
import { refreshGeneratedSiteAssets } from './project-assets.ts';
import type { ProjectAssetRefreshResult } from './project-assets.ts';
import {
  collectProjectSourceFiles,
  createPageSeedContext,
  defaultConfigPath,
  docstubeDirPath,
  ensureDocstubeDir,
  projectDbPath,
  projectManifestPath,
  resolveWorkspacePath,
  withOutputPaths
} from './project-workspace.ts';
import type { PageSeedContext, ProjectSourceFile } from './project-workspace.ts';
import { sourceFilesForPage } from './project-workspace.ts';
import type { StateBackend } from './state-backend.ts';

export type ProjectGenerationInitializationOptions = {
  configPath?: string;
  dbPath?: string;
  workspaceDir: string;
};

export type ProjectGenerationInitializationResult = {
  pagesCount: number;
  resumed: boolean;
  runId: string;
};

export type GeneratedProjectPage = {
  findings: Finding[];
  id: PageId;
  path: RelativePath;
  sections: SectionId[];
  status: ManifestPage['status'];
  title: string;
};

export type ProjectGenerationOptions = ProjectGenerationInitializationOptions & {
  adapterFactory?: ProjectGenerationAdapterFactory;
  now?: () => Timestamp;
};

export type ProjectGenerationResult = ProjectGenerationInitializationResult & {
  assetRefresh: ProjectAssetRefreshResult;
  capFrozen: boolean;
  generatedPages: GeneratedProjectPage[];
  manifest: Manifest;
  manifestPath: string;
  sourceFilesCount: number;
};

const docstubeVersion = '0.0.2';
const defaultTimestamp: Timestamp = '2026-06-16T00:00:00.000Z';

export type ProjectGenerationAdapters = {
  model?: string;
  reviewers: readonly PersonaReviewer[];
  writer: AgentAdapter;
};

export type ProjectGenerationAdapterFactory = (input: {
  config: DocstubeConfig;
  generatedAt: Timestamp;
  pages: readonly ScheduledPage[];
  sourceFiles: readonly ProjectSourceFile[];
  workspaceDir: string;
}) => ProjectGenerationAdapters;

const escapeMarkdownText = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}').replaceAll('<', '&lt;');

const escapeCodeText = (value: string): string => value.replaceAll('`', '\\`');

const yamlString = (value: string): string => JSON.stringify(value);

const astroLayoutPathForPage = (pagePath: RelativePath): string => {
  const marker = '/src/pages/';
  const markerIndex = pagePath.indexOf(marker);
  const layoutPath =
    markerIndex >= 0
      ? posixJoin(pagePath.slice(0, markerIndex), 'src/layouts/DocLayout.astro')
      : posixJoin(posixDirname(pagePath), '../layouts/DocLayout.astro');
  const relativePath = posixRelative(posixDirname(pagePath), layoutPath);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
};

const artifactContentForPage = (input: {
  context?: Pick<PageGenerationContext, 'apiSymbols' | 'sourceFacts'>;
  generatedAt: Timestamp;
  page: ScheduledPage;
  seedContext: PageSeedContext;
  sourceFiles: readonly ProjectSourceFile[];
}): string => {
  const sourceFacts = input.context?.sourceFacts ?? [];
  const sourceLines =
    sourceFacts.length > 0
      ? sourceFacts.slice(0, 12).map((fact) => `- ${escapeMarkdownText(fact)}`)
      : input.sourceFiles.length > 0
        ? input.sourceFiles.slice(0, 12).map((source) => `- \`${escapeCodeText(source.path)}\``)
        : ['- No configured source files were discovered for this deterministic run.'];
  const apiSymbols = input.context?.apiSymbols ?? [];
  const apiLines =
    apiSymbols.length > 0
      ? apiSymbols
          .slice(0, 12)
          .map(
            (symbol) =>
              `- ${escapeMarkdownText(symbol.name)} (${symbol.kind}) from \`${escapeCodeText(symbol.sourcePath)}\``
          )
      : ['- No API symbols were extracted for this deterministic run.'];
  const personaLines = input.seedContext.personas.map((persona) => `  - ${persona}`);

  return [
    '---',
    `id: ${input.page.id}`,
    `title: ${yamlString(input.page.title)}`,
    input.seedContext.site.description ? `description: ${yamlString(input.seedContext.site.description)}` : undefined,
    `layout: ${yamlString(astroLayoutPathForPage(input.page.slug))}`,
    `layoutMode: ${input.seedContext.layout}`,
    'personas:',
    ...personaLines,
    'sections:',
    '  - intro',
    'generated:',
    '  by: docstube',
    `  version: ${yamlString(docstubeVersion)}`,
    `  at: ${yamlString(input.generatedAt)}`,
    '---',
    buildSectionMarker('start', 'intro'),
    '',
    `## ${escapeMarkdownText(input.page.title)}`,
    '',
    `${escapeMarkdownText(input.seedContext.site.name)} documentation page generated from the configured IA.`,
    input.page.brief ? `Brief: ${escapeMarkdownText(input.page.brief)}` : undefined,
    '',
    'Source facts:',
    ...sourceLines,
    '',
    'API symbols:',
    ...apiLines,
    '',
    buildSectionMarker('end', 'intro')
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
};

const writeArtifact = async (workspaceDir: string, artifact: AgentTextArtifact): Promise<void> => {
  const target = resolveWorkspacePath(workspaceDir, artifact.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, artifact.content, 'utf8');
};

const pageManifestUpdate = (input: {
  context: PageGenerationContext;
  page: ScheduledPage;
  result: Awaited<ReturnType<typeof runReplayPageGeneration>>;
  seedContext: PageSeedContext;
}): ManifestPageUpdate => ({
  id: input.result.generatedPage.frontmatter.id,
  path: input.result.artifact.path,
  title: input.result.generatedPage.frontmatter.title,
  status: input.result.page.status === 'flagged' ? 'flagged' : 'passed',
  sections: input.result.generatedPage.frontmatter.sections ?? [],
  provenance: createPageProvenance({
    seedContext: input.seedContext,
    reads: input.context.provenance.reads,
    citations: input.context.provenance.citations
  })
});

const modelForChoice = (choice: AgentChoice): string => choice.model ?? 'default';

const apiKeyForChoice = (choice: AgentChoice): string => {
  const provider = choice.provider ?? 'openai';
  const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const value = process.env[keyName];
  if (!value) {
    throw new Error(`The ${choice.adapter} adapter requires ${keyName} in the environment.`);
  }
  return value;
};

const adapterForChoice = (choice: AgentChoice) => {
  if (choice.adapter === 'codex') {
    return createCodexAdapter({ version: '0.0.0' });
  }
  if (choice.adapter === 'claude') {
    return createClaudeAdapter({ version: '0.0.0' });
  }
  if (choice.adapter === 'gemini') {
    return createGeminiAdapter({ version: '0.0.0' });
  }
  return createDirectApiAdapter({
    provider: choice.provider ?? 'openai',
    baseUrl: choice.baseUrl,
    apiKey: apiKeyForChoice(choice)
  });
};

export const createConfiguredProjectGenerationAdapters: ProjectGenerationAdapterFactory = (input) => {
  const reviewerChoice = input.config.agents.reviewer ?? input.config.agents.writer;
  const reviewerAdapter = adapterForChoice(reviewerChoice);
  return {
    writer: adapterForChoice(input.config.agents.writer),
    model: modelForChoice(input.config.agents.writer),
    reviewers: input.config.personas.map((persona) => ({
      personaId: persona.id,
      adapter: reviewerAdapter
    }))
  };
};

export const createDeterministicProjectGenerationAdapters: ProjectGenerationAdapterFactory = (input) => {
  const artifacts = input.pages.map((page): AgentTextArtifact => {
    const pageSources = sourceFilesForPage(page, input.sourceFiles);
    const seedContext = createPageSeedContext({ config: input.config, page, sources: pageSources });
    const sourceGrounding = createSourceGroundingContext(pageSources);
    return {
      path: page.slug,
      content: artifactContentForPage({
        context: sourceGrounding,
        generatedAt: input.generatedAt,
        page,
        seedContext,
        sourceFiles: pageSources
      }),
      encoding: 'utf8'
    };
  });
  const reviewer = createMockAgentAdapter({
    id: 'project-review-replay',
    version: '0.0.0',
    output: { findings: [] }
  });
  return {
    writer: createMockAgentAdapter({ id: 'project-generation-replay', version: '0.0.0', artifacts }),
    model: 'replay-fixture',
    reviewers: input.config.personas.map((persona) => ({ personaId: persona.id, adapter: reviewer }))
  };
};

export type GenerateConfiguredProjectPagesResult = {
  capFrozen: boolean;
  generatedPages: GeneratedProjectPage[];
  manifestPages: ManifestPageUpdate[];
};

export const generateConfiguredProjectPages = async (input: {
  adapterFactory?: ProjectGenerationAdapterFactory;
  backend: StateBackend;
  config: DocstubeConfig;
  generatedAt: Timestamp;
  glossary: Glossary;
  maxRetries?: number;
  pages: readonly ScheduledPage[];
  runId: string;
  sourceFiles: readonly ProjectSourceFile[];
  workspaceDir: string;
}): Promise<GenerateConfiguredProjectPagesResult> => {
  const adapters = (input.adapterFactory ?? createConfiguredProjectGenerationAdapters)({
    config: input.config,
    generatedAt: input.generatedAt,
    pages: input.pages,
    sourceFiles: input.sourceFiles,
    workspaceDir: input.workspaceDir
  });
  const generatedPages: GeneratedProjectPage[] = [];
  const manifestPages: ManifestPageUpdate[] = [];
  const knownFiles = [
    ...new Set([...input.sourceFiles.map((source) => source.path), ...input.pages.map((page) => page.slug)])
  ];
  const cacheDir = join(docstubeDirPath(input.workspaceDir), 'cache', 'agents');
  const transcriptRunDir = join(docstubeDirPath(input.workspaceDir), 'runs', input.runId);

  const state = await input.pages.reduce<Promise<{ capFrozen: boolean }>>(
    async (previous, page) => {
      const previousState = await previous;
      if (previousState.capFrozen) {
        return previousState;
      }

      const maxPages = input.config.caps?.maxPages;
      if (maxPages !== undefined && generatedPages.length >= maxPages) {
        await freezeRunForCaps({
          backend: input.backend,
          runId: input.runId,
          note: `Stopped after ${generatedPages.length} generated pages because caps.maxPages=${maxPages}.`,
          now: () => input.generatedAt
        });
        return { capFrozen: true };
      }

      const pageSources = sourceFilesForPage(page, input.sourceFiles);
      const seedContext = createPageSeedContext({ config: input.config, page, sources: pageSources });
      const context = await createPageGenerationContext({
        config: input.config,
        glossary: input.glossary,
        page,
        sources: pageSources,
        workspaceDir: input.workspaceDir
      });
      const verifiers = createProjectPageVerifiers({ context, knownFiles });
      const result = await runReplayPageGeneration({
        backend: input.backend,
        runId: input.runId,
        repoRoot: input.workspaceDir,
        page,
        writer: adapters.writer,
        reviewers: adapters.reviewers,
        verifiers,
        cacheDir,
        context,
        maxRetries: input.maxRetries ?? 1,
        model: adapters.model,
        now: () => input.generatedAt,
        transcriptRunDir
      });
      await writeArtifact(input.workspaceDir, result.artifact);
      manifestPages.push(pageManifestUpdate({ context, page, result, seedContext }));
      generatedPages.push({
        id: result.generatedPage.frontmatter.id,
        path: result.artifact.path,
        title: result.generatedPage.frontmatter.title,
        status: result.page.status === 'flagged' ? 'flagged' : 'passed',
        sections: result.generatedPage.frontmatter.sections ?? [],
        findings: result.page.findings
      });
      return { capFrozen: false };
    },
    Promise.resolve({ capFrozen: false })
  );

  return { capFrozen: state.capFrozen, generatedPages, manifestPages };
};

export const initializeProjectGeneration = async (
  input: ProjectGenerationInitializationOptions
): Promise<ProjectGenerationInitializationResult> => {
  const dbPath = input.dbPath ?? projectDbPath(input.workspaceDir);
  await ensureDocstubeDir(input.workspaceDir);
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const result = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath ?? defaultConfigPath,
      workspaceDir: input.workspaceDir
    });
    return {
      pagesCount: result.pages.length,
      resumed: result.resumed,
      runId: result.run.id
    };
  } finally {
    await backend.close();
  }
};

export const generateProjectDocumentation = async (
  input: ProjectGenerationOptions
): Promise<ProjectGenerationResult> => {
  const dbPath = input.dbPath ?? projectDbPath(input.workspaceDir);
  const manifestPath = projectManifestPath(input.workspaceDir);
  const now = input.now ?? (() => defaultTimestamp);

  await ensureDocstubeDir(input.workspaceDir);
  const backend = createLocalBackend(openDocstubeDatabase(dbPath));
  try {
    const initialized = await initializeRunFromConfigFamily({
      backend,
      configPath: input.configPath ?? defaultConfigPath,
      workspaceDir: input.workspaceDir,
      now
    });
    await transitionRunStatus({ backend, runId: initialized.run.id, status: 'running', now });

    const sourceFiles = await collectProjectSourceFiles({
      workspaceDir: input.workspaceDir,
      config: initialized.config
    });
    const pages = withOutputPaths(initialized.config, initialized.scheduledPages);
    const generatedAt = now();
    const generation = await generateConfiguredProjectPages({
      adapterFactory: input.adapterFactory,
      backend,
      config: initialized.config,
      generatedAt,
      glossary: initialized.glossary,
      pages,
      runId: initialized.run.id,
      sourceFiles,
      workspaceDir: input.workspaceDir
    });
    const manifest = updateManifest({
      generatedWith: { name: 'docstube', version: docstubeVersion },
      pages: generation.manifestPages
    });

    await writeManifestFile(manifestPath, manifest);
    const assetRefresh = await refreshGeneratedSiteAssets({
      config: initialized.config,
      glossary: initialized.glossary,
      ia: initialized.ia,
      workspaceDir: input.workspaceDir
    });
    if (!generation.capFrozen) {
      await transitionRunStatus({ backend, runId: initialized.run.id, status: 'completed', now });
    }

    return {
      assetRefresh,
      capFrozen: generation.capFrozen,
      generatedPages: generation.generatedPages,
      manifest,
      manifestPath,
      pagesCount: generation.generatedPages.length,
      resumed: initialized.resumed,
      runId: initialized.run.id,
      sourceFilesCount: sourceFiles.length
    };
  } finally {
    await backend.close();
  }
};
