import { createHash } from 'node:crypto';
import { iaSchema, pageIdSchema } from '@docstube/contracts';
import type { DocstubeConfig, Glossary, Ia, IaNode, PageId } from '@docstube/contracts';
import { loadProjectConfigFamily } from './project-workspace.ts';
import { StateBackendError, pageProgressStatuses } from './state-backend.ts';
import type { PageDetail, PageProgress, RunRecord, RunStatus, StateBackend } from './state-backend.ts';

export type ScheduledPage = {
  brief?: string;
  depth: number;
  id: PageId;
  order: number;
  slug: string;
  title: string;
};

export type RunInitializationOptions = {
  backend: StateBackend;
  configPath?: string;
  now?: () => string;
  runId?: string;
  workspaceDir: string;
};

export type RunInitializationResult = {
  config: DocstubeConfig;
  glossary: Glossary;
  ia: Ia;
  pages: PageDetail[];
  resumed: boolean;
  run: RunRecord;
  scheduledPages: ScheduledPage[];
};

export type TerminalProgressState = {
  capFrozen: boolean;
  counts: Record<PageProgress, number>;
  nextPageId?: string;
  note?: string;
  runId: string;
  status: RunStatus;
  totalPages: number;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const defaultNow = (): string => new Date().toISOString();

export const deriveRunId = (config: DocstubeConfig, ia: Ia): string =>
  `run-${sha256(JSON.stringify({ site: config.site.name, nav: ia.nav })).slice(0, 12)}`;

const pageIdForNode = (parentIds: readonly string[], node: IaNode): PageId =>
  pageIdSchema.parse([...parentIds, node.id].join('/'));

const slugForPage = (pageId: PageId, node: IaNode): string =>
  node.path ?? (pageId === 'overview' ? 'index.mdx' : `${pageId}.mdx`);

const scheduleNode = (
  node: IaNode,
  parentIds: readonly string[],
  depth: number,
  pages: ScheduledPage[]
): ScheduledPage[] => {
  const children = node.children ?? [];
  const shouldSchedule = node.path !== undefined || children.length === 0;
  const pageId = pageIdForNode(parentIds, node);

  if (shouldSchedule) {
    pages.push({
      id: pageId,
      title: node.title,
      brief: node.brief,
      slug: slugForPage(pageId, node),
      depth,
      order: pages.length
    });
  }

  for (const child of children) {
    scheduleNode(child, [...parentIds, node.id], depth + 1, pages);
  }

  return pages;
};

export const schedulePagesFromIa = (ia: Ia): ScheduledPage[] => {
  const parsed = iaSchema.parse(ia);
  const pages: ScheduledPage[] = [];
  for (const node of parsed.nav) {
    scheduleNode(node, [], 0, pages);
  }
  return pages;
};

const scheduledPageToDetail = (runId: string, page: ScheduledPage, updatedAt: string): PageDetail => ({
  id: page.id,
  runId,
  title: page.title,
  slug: page.slug,
  status: 'queued',
  approved: false,
  findings: [],
  updatedAt
});

export const initializeRunFromConfigFamily = async (
  options: RunInitializationOptions
): Promise<RunInitializationResult> => {
  const now = options.now ?? defaultNow;
  const configPath = options.configPath ?? 'docstube.yml';
  const { config, ia, glossary } = await loadProjectConfigFamily(options.workspaceDir, configPath);
  const scheduledPages = schedulePagesFromIa(ia);
  const runId = options.runId ?? deriveRunId(config, ia);

  await options.backend.setConfig(config);
  const existingRun = await options.backend.getRun(runId);
  if (existingRun) {
    return {
      config,
      ia,
      glossary,
      scheduledPages,
      run: existingRun,
      pages: await Promise.all(scheduledPages.map((page) => options.backend.getPage(page.id))).then((pages) =>
        pages.filter((page): page is PageDetail => page !== null)
      ),
      resumed: true
    };
  }

  const timestamp = now();
  const run: RunRecord = {
    id: runId,
    status: 'queued',
    capFrozen: false,
    startedAt: timestamp,
    updatedAt: timestamp
  };

  await options.backend.saveRun(run);
  const pages = await Promise.all(
    scheduledPages.map((page) => options.backend.upsertPage(scheduledPageToDetail(runId, page, timestamp)))
  );

  return { config, ia, glossary, scheduledPages, run, pages, resumed: false };
};

export const createTerminalProgressState = (run: RunRecord, pages: readonly PageDetail[]): TerminalProgressState => {
  const counts = Object.fromEntries(pageProgressStatuses.map((status) => [status, 0])) as Record<PageProgress, number>;
  for (const page of pages) {
    counts[page.status] += 1;
  }

  const nextPage = pages.find((page) => page.status === 'queued' || page.status === 'retrying');
  return {
    runId: run.id,
    status: run.status,
    capFrozen: run.capFrozen,
    note: run.note,
    totalPages: pages.length,
    counts,
    nextPageId: nextPage?.id
  };
};

const requireRun = async (backend: StateBackend, runId: string): Promise<RunRecord> => {
  const run = await backend.getRun(runId);
  if (!run) {
    throw new StateBackendError('not_found', `run not found: ${runId}`);
  }
  return run;
};

export const transitionRunStatus = async (input: {
  backend: StateBackend;
  now?: () => string;
  runId: string;
  status: RunStatus;
}): Promise<RunRecord> => {
  const now = input.now ?? defaultNow;
  const run = await requireRun(input.backend, input.runId);
  return input.backend.saveRun({ ...run, status: input.status, updatedAt: now() });
};

export const freezeRunForCaps = async (input: {
  backend: StateBackend;
  note: string;
  now?: () => string;
  runId: string;
}): Promise<RunRecord> => {
  const now = input.now ?? defaultNow;
  const run = await requireRun(input.backend, input.runId);
  return input.backend.saveRun({
    ...run,
    capFrozen: true,
    note: input.note,
    updatedAt: now()
  });
};

export const resumeRunAfterCapIncrease = async (input: {
  backend: StateBackend;
  now?: () => string;
  runId: string;
}): Promise<RunRecord> => {
  const now = input.now ?? defaultNow;
  const run = await requireRun(input.backend, input.runId);
  return input.backend.saveRun({
    ...run,
    status: run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' ? run.status : 'queued',
    capFrozen: false,
    note: undefined,
    updatedAt: now()
  });
};
