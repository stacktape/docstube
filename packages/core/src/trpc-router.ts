import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  docstubeConfigSchema,
  feedbackRecordSchema,
  iaSchema,
  pageIdSchema,
  parseDocstubeConfig,
  relativePathSchema
} from '@docstube/contracts';
import type { Ia } from '@docstube/contracts';
import { compileMdxBodyToHtml } from '@docstube/verifiers';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { extractSectionMarkers } from '@docstube/contracts';
import { applyFeedbackToProjectFiles, feedbackApplicationInputSchema } from './feedback-application.ts';
import { createTerminalProgressState } from './pipeline-run.ts';
import {
  loadProjectConfigFamily,
  normalizeRelativePath,
  pathExists,
  resolveWorkspacePath
} from './project-workspace.ts';
import { writeSetupWizardFiles } from './setup-files.ts';
import type { StateBackend } from './state-backend.ts';

// tRPC router skeleton mounted by the local server (Task 17). It exposes the minimum procedures the
// setup wizard, generation dashboard, and review UI need, each delegating to the `StateBackend`.
// Input validation reuses the frozen S0 contracts so the API and on-disk shapes cannot drift.

export type TrpcContext = {
  backend: StateBackend;
  configPath?: string;
  workspaceDir?: string;
};

const t = initTRPC.context<TrpcContext>().create();

const themeTokensInput = z.record(z.string(), z.union([z.string(), z.number()]));
const runStatusInput = z.object({ runId: z.string().min(1) });
const pageListInput = z.object({ runId: z.string().min(1).optional() }).optional();
const setupReadInput = z.object({ configPath: relativePathSchema.optional() }).optional();
const setupSaveInput = z.strictObject({
  config: docstubeConfigSchema,
  configPath: relativePathSchema.optional(),
  ia: iaSchema,
  themeTokens: themeTokensInput.default({})
});
const feedbackListInput = z.object({ pageId: pageIdSchema.optional() }).optional();
// Page references validate `pageId` with the frozen S0 page-ID rules, never an ad-hoc string, so
// the API cannot accept IDs the rest of the contracts reject.
const pageRefInput = z.object({ pageId: pageIdSchema });

const pageStatusLabel = (status: string): string => {
  if (status === 'queued') {
    return 'Queued for generation';
  }
  if (status === 'running') {
    return 'Writer is drafting the page';
  }
  if (status === 'retrying') {
    return 'Queued for refinement retry';
  }
  if (status === 'passed') {
    return 'Passed deterministic checks';
  }
  return 'Flagged for review';
};

const splitMdxBody = (content: string): string => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?(?<body>[\s\S]*)$/u.exec(content);
  return match?.groups?.body ?? content;
};

const readGeneratedPageContent = async (input: { ctx: TrpcContext; slug?: string }): Promise<string> => {
  if (!input.ctx.workspaceDir || !input.slug) {
    return '';
  }

  try {
    return await readFile(resolveWorkspacePath(input.ctx.workspaceDir, input.slug), 'utf8');
  } catch {
    return '';
  }
};

const draftSetupState = (ctx: TrpcContext, configPath: string) => {
  const siteName = ctx.workspaceDir ? basename(ctx.workspaceDir) : 'docstube';
  const config = parseDocstubeConfig({
    site: { name: siteName || 'docstube', locale: 'en' },
    docsType: 'library',
    output: { dir: 'docs', layout: 'single-tree' },
    personas: [{ id: 'developer', title: 'Developer', goals: ['integrate quickly'] }],
    agents: { writer: { adapter: 'codex' } },
    sources: [{ kind: 'path', path: 'src' }],
    ia: 'ia.yml',
    glossary: 'glossary.yaml',
    theme: { credit: true, tokens: { accent: '#2563eb', surface: '#f8fafc', radius: 8 } }
  });
  const ia = {
    version: 1,
    layout: 'single-tree',
    nav: [{ id: 'overview', title: 'Overview', path: 'overview.mdx', brief: 'Project overview.' }]
  } satisfies Ia;
  return {
    config,
    configPath,
    ia,
    themeTokens: config.theme?.tokens ?? {}
  };
};

const setupState = async (ctx: TrpcContext, configPath?: string) => {
  const effectiveConfigPath = configPath ?? ctx.configPath ?? 'docstube.yml';
  const themeTokens = await ctx.backend.getThemeTokens();

  if (ctx.workspaceDir) {
    const configExists = await pathExists(
      resolveWorkspacePath(ctx.workspaceDir, normalizeRelativePath(effectiveConfigPath))
    );
    if (configExists) {
      const family = await loadProjectConfigFamily(ctx.workspaceDir, effectiveConfigPath);
      await ctx.backend.setConfig(family.config);
      return {
        config: family.config,
        configPath: family.configPath,
        ia: family.ia,
        themeTokens: Object.keys(themeTokens).length > 0 ? themeTokens : (family.config.theme?.tokens ?? {})
      };
    }
  }

  const [config, proposals] = await Promise.all([ctx.backend.getConfig(), ctx.backend.listIaProposals()]);
  const ia = proposals.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.ia ?? null;
  if (!config && !ia) {
    return draftSetupState(ctx, effectiveConfigPath);
  }
  return {
    config,
    configPath: effectiveConfigPath,
    ia,
    themeTokens
  };
};

const dashboardState = async (ctx: TrpcContext) => {
  const pageSummaries = await ctx.backend.listPages();
  const pageDetails = await Promise.all(pageSummaries.map((page) => ctx.backend.getPage(page.id))).then((pages) =>
    pages.filter((page) => page !== null)
  );
  const run = pageDetails[0]?.runId ? await ctx.backend.getRun(pageDetails[0].runId) : null;
  const pages = await Promise.all(
    pageDetails.map(async (page) => ({
      ...page,
      preview: await readGeneratedPageContent({ ctx, slug: page.slug }),
      timeline: [{ at: page.updatedAt, label: pageStatusLabel(page.status), status: page.status }]
    }))
  );

  return {
    run,
    pages,
    terminalProgress: run ? createTerminalProgressState(run, pageDetails) : null
  };
};

const reviewState = async (ctx: TrpcContext) => {
  const pageSummaries = await ctx.backend.listPages();
  const pageDetails = await Promise.all(pageSummaries.map((page) => ctx.backend.getPage(page.id))).then((pages) =>
    pages.filter((page) => page !== null)
  );
  const pages = await Promise.all(
    pageDetails.map(async (page) => {
      const content = await readGeneratedPageContent({ ctx, slug: page.slug });
      const body = splitMdxBody(content);
      const renderedHtml = body
        ? await compileMdxBodyToHtml(body)
        : '<article><p>No generated preview yet.</p></article>';
      const markerIds = [...new Set(extractSectionMarkers(body).map((marker) => marker.sectionId))];
      return {
        ...page,
        renderedHtml,
        sections: markerIds.map((id) => ({ id, title: id }))
      };
    })
  );

  return {
    feedback: await ctx.backend.listFeedback(),
    pages
  };
};

export const appRouter = t.router({
  setup: t.router({
    read: t.procedure.input(setupReadInput).query(({ ctx, input }) => setupState(ctx, input?.configPath)),
    save: t.procedure.input(setupSaveInput).mutation(async ({ ctx, input }) => {
      const effectiveConfigPath = input.configPath ?? ctx.configPath ?? 'docstube.yml';
      let config = input.config;
      let ia = input.ia;
      if (ctx.workspaceDir) {
        const written = await writeSetupWizardFiles({
          config,
          configPath: effectiveConfigPath,
          ia,
          workspaceDir: ctx.workspaceDir
        });
        config = written.config;
        ia = written.ia;
      }
      await Promise.all([
        ctx.backend.setConfig(config),
        ctx.backend.setThemeTokens(input.themeTokens),
        ctx.backend.saveIaProposal({
          id: 'current-config',
          label: 'Current config',
          ia,
          createdAt: new Date().toISOString()
        })
      ]);
      return { config, configPath: effectiveConfigPath, ia, themeTokens: input.themeTokens };
    })
  }),
  config: t.router({
    read: t.procedure.query(({ ctx }) => ctx.backend.getConfig()),
    write: t.procedure.input(docstubeConfigSchema).mutation(async ({ ctx, input }) => {
      await ctx.backend.setConfig(input);
      return { ok: true } as const;
    })
  }),
  ia: t.router({
    proposals: t.procedure.query(({ ctx }) => ctx.backend.listIaProposals())
  }),
  theme: t.router({
    readTokens: t.procedure.query(({ ctx }) => ctx.backend.getThemeTokens()),
    writeTokens: t.procedure.input(themeTokensInput).mutation(async ({ ctx, input }) => {
      await ctx.backend.setThemeTokens(input);
      return { ok: true } as const;
    })
  }),
  run: t.router({
    status: t.procedure.input(runStatusInput).query(({ ctx, input }) => ctx.backend.getRun(input.runId))
  }),
  dashboard: t.router({
    read: t.procedure.query(({ ctx }) => dashboardState(ctx))
  }),
  review: t.router({
    read: t.procedure.query(({ ctx }) => reviewState(ctx))
  }),
  pages: t.router({
    list: t.procedure.input(pageListInput).query(({ ctx, input }) => ctx.backend.listPages(input?.runId)),
    detail: t.procedure.input(pageRefInput).query(({ ctx, input }) => ctx.backend.getPage(input.pageId)),
    approve: t.procedure.input(pageRefInput).mutation(({ ctx, input }) => ctx.backend.approvePage(input.pageId)),
    regenerate: t.procedure.input(pageRefInput).mutation(({ ctx, input }) => ctx.backend.regeneratePage(input.pageId))
  }),
  feedback: t.router({
    write: t.procedure.input(feedbackApplicationInputSchema).mutation(({ ctx, input }) =>
      applyFeedbackToProjectFiles({
        ...input,
        backend: ctx.backend,
        configPath: ctx.configPath,
        workspaceDir: ctx.workspaceDir
      })
    ),
    list: t.procedure.input(feedbackListInput).query(({ ctx, input }) => ctx.backend.listFeedback(input?.pageId)),
    submit: t.procedure.input(feedbackRecordSchema).mutation(({ ctx, input }) => ctx.backend.submitFeedback(input))
  })
});

export type AppRouter = typeof appRouter;

export type AppRouterProcedure = {
  path: string;
  type: string;
};

export type JsonSchema = Record<string, unknown>;

// A procedure plus the JSON Schema of its declared input (null when the procedure takes no input).
// The input schema is what binds each procedure to a frozen S0 contract; capturing it lets the
// contract test detect input drift, not just an added/removed procedure.
export type AppRouterProcedureContract = AppRouterProcedure & {
  input: JsonSchema | null;
};

const trpcDefinitionKey = '_def' as const;

type ProcedureDefinition = {
  [trpcDefinitionKey]: {
    inputs?: z.ZodType[];
    type: string;
  };
};

type ProcedureDefs = Record<string, ProcedureDefinition>;

const routerProcedureDefs = (): ProcedureDefs =>
  (appRouter as unknown as { [trpcDefinitionKey]: { procedures: ProcedureDefs } })[trpcDefinitionKey].procedures;

// `io: 'input'` mirrors the on-disk/request shape: default-bearing fields are optional on input.
const toInputJsonSchema = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as unknown as JsonSchema;

// Introspect the built router into a stable, sortable list of procedure paths and kinds. The
// snapshot/diff test asserts against this so an accidental contract change is caught in review.
export const appRouterProcedures = (): AppRouterProcedure[] =>
  Object.entries(routerProcedureDefs())
    .map(([path, procedure]) => ({ path, type: procedure[trpcDefinitionKey].type }))
    .sort((a, b) => a.path.localeCompare(b.path));

// Introspect the router into its full input contract: each procedure with the JSON Schema of its
// input. The contract test diffs these against the frozen S0 contracts so input-schema drift (for
// example a `pageId` that no longer obeys the page-ID rules) fails review.
export const appRouterContract = (): AppRouterProcedureContract[] =>
  Object.entries(routerProcedureDefs())
    .map(([path, procedure]) => {
      const definition = procedure[trpcDefinitionKey];
      const inputSchema = definition.inputs?.at(-1);
      return { path, type: definition.type, input: inputSchema ? toInputJsonSchema(inputSchema) : null };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
