import { docstubeConfigSchema, feedbackRecordSchema, pageIdSchema, parseDocstubeConfig } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import type { StateBackend } from './state-backend';
import { appRouter, appRouterContract, appRouterProcedures, type AppRouterProcedureContract } from './trpc-router';

const toInputJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as unknown as Record<string, unknown>;

const makeCaller = (): { caller: ReturnType<typeof appRouter.createCaller>; backend: StateBackend } => {
  const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
  return { caller: appRouter.createCaller({ backend }), backend };
};

describe('AppRouter contract', () => {
  it('exposes exactly the minimum UI procedures', () => {
    expect(appRouterProcedures()).toEqual([
      { path: 'config.read', type: 'query' },
      { path: 'config.write', type: 'mutation' },
      { path: 'feedback.submit', type: 'mutation' },
      { path: 'ia.proposals', type: 'query' },
      { path: 'pages.approve', type: 'mutation' },
      { path: 'pages.detail', type: 'query' },
      { path: 'pages.list', type: 'query' },
      { path: 'pages.regenerate', type: 'mutation' },
      { path: 'run.status', type: 'query' },
      { path: 'theme.readTokens', type: 'query' },
      { path: 'theme.writeTokens', type: 'mutation' }
    ]);
  });

  it('snapshots the AppRouter procedure surface', () => {
    expect(appRouterProcedures()).toMatchSnapshot();
  });

  // The surface snapshot above only proves which procedures exist; this diff test proves each
  // procedure's input is wired to the frozen S0 contract, so an input-schema change (or a
  // loosened `pageId`) fails review instead of silently drifting from the contracts.
  it('binds every procedure input to the frozen S0 contracts', () => {
    const byPath = Object.fromEntries(
      appRouterContract().map((procedure): [string, AppRouterProcedureContract] => [procedure.path, procedure])
    );

    // Input-free procedures expose no input schema.
    expect(byPath['config.read']?.input).toBeNull();
    expect(byPath['ia.proposals']?.input).toBeNull();
    expect(byPath['theme.readTokens']?.input).toBeNull();

    // Config and feedback inputs reuse the frozen contract schemas verbatim.
    expect(byPath['config.write']?.input).toEqual(toInputJsonSchema(docstubeConfigSchema));
    expect(byPath['feedback.submit']?.input).toEqual(toInputJsonSchema(feedbackRecordSchema));

    // Page procedures validate `pageId` with the frozen page-ID rules, not an ad-hoc string. This
    // fails if `pageId` is ever loosened back to a plain non-empty string.
    const pageRefInput = toInputJsonSchema(z.object({ pageId: pageIdSchema }));
    expect(byPath['pages.detail']?.input).toEqual(pageRefInput);
    expect(byPath['pages.approve']?.input).toEqual(pageRefInput);
    expect(byPath['pages.regenerate']?.input).toEqual(pageRefInput);

    // Theme token writes accept the opaque string/number token map; a tightened or widened value
    // type fails here instead of silently changing the editor's API contract.
    expect(byPath['theme.writeTokens']?.input).toEqual(
      toInputJsonSchema(z.record(z.string(), z.union([z.string(), z.number()])))
    );

    // Run status requires a non-empty `runId`; page listing scopes by an optional `runId`. Pinning
    // both inputs catches drift in the dashboard read API, not just added/removed procedures.
    expect(byPath['run.status']?.input).toEqual(toInputJsonSchema(z.object({ runId: z.string().min(1) })));
    expect(byPath['pages.list']?.input).toEqual(
      toInputJsonSchema(z.object({ runId: z.string().min(1).optional() }).optional())
    );
  });

  it('drives the local backend through the router', async () => {
    const { caller, backend } = makeCaller();

    expect(await caller.config.read()).toBeNull();

    const config = parseDocstubeConfig({
      site: { name: 'Acme Toolkit' },
      docsType: 'library',
      personas: [{ id: 'developer', title: 'Application developer' }],
      agents: { writer: { adapter: 'codex' } }
    });
    await caller.config.write(config);
    expect((await caller.config.read())?.site.name).toBe('Acme Toolkit');

    await caller.theme.writeTokens({ 'color-accent': '#3b82f6' });
    expect(await caller.theme.readTokens()).toEqual({ 'color-accent': '#3b82f6' });

    await backend.upsertPage({
      id: 'overview',
      runId: 'run-1',
      title: 'Overview',
      status: 'flagged',
      approved: false,
      findings: [{ code: 'mdx-compile', severity: 'major', origin: 'verifier', message: 'broken JSX' }],
      updatedAt: '2026-06-16T00:00:00.000Z'
    });

    expect((await caller.pages.list()).map((page) => page.id)).toEqual(['overview']);
    expect((await caller.pages.detail({ pageId: 'overview' }))?.findings).toHaveLength(1);

    const approved = await caller.pages.approve({ pageId: 'overview' });
    expect(approved.approved).toBe(true);

    const regenerated = await caller.pages.regenerate({ pageId: 'overview' });
    expect(regenerated.status).toBe('queued');
    expect(regenerated.findings).toEqual([]);

    const feedback = await caller.feedback.submit({
      id: 'feedback-1',
      createdAt: '2026-06-16T00:00:00.000Z',
      scope: 'page',
      message: 'Bury the install step less.',
      pageId: 'overview',
      category: 'uncategorized',
      status: 'open'
    });
    expect(feedback.id).toBe('feedback-1');

    await backend.close();
  });
});
