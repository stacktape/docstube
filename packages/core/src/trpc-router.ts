import { docstubeConfigSchema, feedbackRecordSchema, pageIdSchema } from '@docstube/contracts';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type { StateBackend } from './state-backend.ts';

// tRPC router skeleton mounted by the local server (Task 17). It exposes the minimum procedures the
// setup wizard, generation dashboard, and review UI need, each delegating to the `StateBackend`.
// Input validation reuses the frozen S0 contracts so the API and on-disk shapes cannot drift.

export type TrpcContext = {
  backend: StateBackend;
};

const t = initTRPC.context<TrpcContext>().create();

const themeTokensInput = z.record(z.string(), z.union([z.string(), z.number()]));
const runStatusInput = z.object({ runId: z.string().min(1) });
const pageListInput = z.object({ runId: z.string().min(1).optional() }).optional();
// Page references validate `pageId` with the frozen S0 page-ID rules, never an ad-hoc string, so
// the API cannot accept IDs the rest of the contracts reject.
const pageRefInput = z.object({ pageId: pageIdSchema });

export const appRouter = t.router({
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
  pages: t.router({
    list: t.procedure.input(pageListInput).query(({ ctx, input }) => ctx.backend.listPages(input?.runId)),
    detail: t.procedure.input(pageRefInput).query(({ ctx, input }) => ctx.backend.getPage(input.pageId)),
    approve: t.procedure.input(pageRefInput).mutation(({ ctx, input }) => ctx.backend.approvePage(input.pageId)),
    regenerate: t.procedure.input(pageRefInput).mutation(({ ctx, input }) => ctx.backend.regeneratePage(input.pageId))
  }),
  feedback: t.router({
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
