import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSectionMarker,
  docstubeConfigSchema,
  feedbackRecordSchema,
  iaSchema,
  pageIdSchema,
  parseDocstubeConfig,
  relativePathSchema
} from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDocstubeDatabase } from './db-migrations.ts';
import { createLocalBackend } from './local-backend.ts';
import type { StateBackend } from './state-backend.ts';
import {
  appRouter,
  appRouterContract,
  appRouterProcedures,
  type AppRouterProcedureContract,
  type TrpcContext
} from './trpc-router.ts';

const toInputJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as unknown as Record<string, unknown>;

const makeCaller = (
  context: Partial<Omit<TrpcContext, 'backend'>> = {}
): { caller: ReturnType<typeof appRouter.createCaller>; backend: StateBackend } => {
  const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
  return { caller: appRouter.createCaller({ backend, ...context }), backend };
};

describe('AppRouter contract', () => {
  it('exposes exactly the minimum UI procedures', () => {
    expect(appRouterProcedures()).toEqual([
      { path: 'config.read', type: 'query' },
      { path: 'config.write', type: 'mutation' },
      { path: 'dashboard.read', type: 'query' },
      { path: 'feedback.list', type: 'query' },
      { path: 'feedback.submit', type: 'mutation' },
      { path: 'ia.proposals', type: 'query' },
      { path: 'pages.approve', type: 'mutation' },
      { path: 'pages.detail', type: 'query' },
      { path: 'pages.list', type: 'query' },
      { path: 'pages.regenerate', type: 'mutation' },
      { path: 'review.read', type: 'query' },
      { path: 'run.status', type: 'query' },
      { path: 'setup.read', type: 'query' },
      { path: 'setup.save', type: 'mutation' },
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
    expect(byPath['dashboard.read']?.input).toBeNull();
    expect(byPath['ia.proposals']?.input).toBeNull();
    expect(byPath['review.read']?.input).toBeNull();
    expect(byPath['theme.readTokens']?.input).toBeNull();

    // Config and feedback inputs reuse the frozen contract schemas verbatim.
    expect(byPath['config.write']?.input).toEqual(toInputJsonSchema(docstubeConfigSchema));
    expect(byPath['feedback.submit']?.input).toEqual(toInputJsonSchema(feedbackRecordSchema));
    expect(byPath['setup.save']?.input).toEqual(
      toInputJsonSchema(
        z.strictObject({
          config: docstubeConfigSchema,
          configPath: relativePathSchema.optional(),
          ia: iaSchema,
          themeTokens: z.record(z.string(), z.union([z.string(), z.number()])).default({})
        })
      )
    );

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
    expect(byPath['feedback.list']?.input).toEqual(
      toInputJsonSchema(z.object({ pageId: pageIdSchema.optional() }).optional())
    );

    // Run status requires a non-empty `runId`; page listing scopes by an optional `runId`. Pinning
    // both inputs catches drift in the dashboard read API, not just added/removed procedures.
    expect(byPath['run.status']?.input).toEqual(toInputJsonSchema(z.object({ runId: z.string().min(1) })));
    expect(byPath['pages.list']?.input).toEqual(
      toInputJsonSchema(z.object({ runId: z.string().min(1).optional() }).optional())
    );
    expect(byPath['setup.read']?.input).toEqual(
      toInputJsonSchema(z.object({ configPath: relativePathSchema.optional() }).optional())
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
    expect((await caller.feedback.list({ pageId: 'overview' })).map((record) => record.id)).toEqual(['feedback-1']);

    await backend.close();
  });

  it('loads and saves setup state through real config-family files', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-trpc-setup-'));
    const { caller, backend } = makeCaller({ workspaceDir });
    try {
      const config = parseDocstubeConfig({
        site: { name: 'Acme Toolkit' },
        docsType: 'library',
        output: { dir: 'docs', layout: 'single-tree' },
        personas: [{ id: 'developer', title: 'Developer' }],
        agents: { writer: { adapter: 'codex' } },
        theme: { credit: true, tokens: { accent: '#2563eb' } }
      });
      const ia = {
        version: 1 as const,
        nav: [{ id: 'overview', title: 'Overview', brief: 'Explain Acme.' }]
      };

      await caller.setup.save({ config, ia, themeTokens: { accent: '#2563eb' } });
      const loaded = await caller.setup.read();

      expect(loaded.config?.site.name).toBe('Acme Toolkit');
      expect(loaded.ia?.nav[0]?.id).toBe('overview');
      expect(loaded.themeTokens).toEqual({ accent: '#2563eb' });
      await expect(readFile(join(workspaceDir, 'docstube.yml'), 'utf8')).resolves.toContain('Acme Toolkit');
      await expect(readFile(join(workspaceDir, 'ia.yml'), 'utf8')).resolves.toContain('Explain Acme.');
      await expect(readFile(join(workspaceDir, 'glossary.yaml'), 'utf8')).resolves.toContain('terms: []');
    } finally {
      await backend.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('surfaces invalid existing setup files instead of treating them as missing setup state', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-trpc-invalid-setup-'));
    const { caller, backend } = makeCaller({ workspaceDir });
    try {
      await writeFile(join(workspaceDir, 'docstube.yml'), 'version: 1\nsite:\n  name: 9\n', 'utf8');

      await expect(caller.setup.read()).rejects.toThrow(/Invalid docstube\.yml/u);
    } finally {
      await backend.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('builds dashboard and review read models from persisted pages and generated files', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'docstube-trpc-read-model-'));
    const { caller, backend } = makeCaller({ workspaceDir });
    try {
      await backend.saveRun({
        id: 'run-1',
        status: 'running',
        capFrozen: false,
        startedAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:00:00.000Z'
      });
      await backend.upsertPage({
        id: 'overview',
        runId: 'run-1',
        title: 'Overview',
        slug: 'docs/src/pages/index.mdx',
        status: 'flagged',
        approved: false,
        findings: [{ code: 'persona-fit', severity: 'major', origin: 'reviewer', message: 'Needs quickstart.' }],
        updatedAt: '2026-06-16T00:00:00.000Z'
      });
      await mkdir(join(workspaceDir, 'docs', 'src', 'pages'), { recursive: true });
      await writeFile(
        join(workspaceDir, 'docs', 'src', 'pages', 'index.mdx'),
        [
          '---',
          'id: overview',
          'title: Overview',
          'sections:',
          '  - intro',
          'generated:',
          '  by: docstube',
          '  version: "0.0.2"',
          '  at: "2026-06-16T00:00:00.000Z"',
          '---',
          buildSectionMarker('start', 'intro'),
          '## Overview',
          'Preview body.',
          buildSectionMarker('end', 'intro')
        ].join('\n'),
        'utf8'
      );

      const dashboard = await caller.dashboard.read();
      expect(dashboard.run?.id).toBe('run-1');
      expect(dashboard.pages[0]?.preview).toContain('Preview body.');
      expect(dashboard.terminalProgress?.counts.flagged).toBe(1);

      const review = await caller.review.read();
      expect(review.pages[0]?.renderedHtml).toContain('Preview body.');
      expect(review.pages[0]?.sections).toEqual([{ id: 'intro', title: 'intro' }]);
    } finally {
      await backend.close();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
