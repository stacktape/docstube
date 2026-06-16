import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Ia } from '@docstube/contracts';
import { openDocstubeDatabase } from './db-migrations';
import { createLocalBackend } from './local-backend';
import {
  createTerminalProgressState,
  freezeRunForCaps,
  initializeRunFromConfigFamily,
  resumeRunAfterCapIncrease,
  schedulePagesFromIa,
  transitionRunStatus
} from './pipeline-run';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const timestamp = '2026-06-16T00:00:00.000Z';
const laterTimestamp = '2026-06-16T00:05:00.000Z';

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'docstube-run-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe('pipeline run initialization', () => {
  it('initializes a durable run from config-family fixtures', async () => {
    const backend = createLocalBackend(openDocstubeDatabase(':memory:'));

    const result = await initializeRunFromConfigFamily({
      backend,
      workspaceDir: fixturesDir,
      runId: 'run-fixture',
      now: () => timestamp
    });

    expect(result.resumed).toBe(false);
    expect(result.config.site.name).toBe('Acme Toolkit');
    expect(result.glossary.terms.map((term) => term.id)).toEqual(['codemap', 'persona']);
    expect(result.run).toMatchObject({ id: 'run-fixture', status: 'queued', capFrozen: false });
    expect(result.scheduledPages.map((page) => [page.id, page.slug, page.depth])).toEqual([
      ['overview', 'overview.mdx', 0],
      ['guides/install', 'guides/install.mdx', 1]
    ]);
    expect(await backend.listPages('run-fixture')).toEqual([
      expect.objectContaining({ id: 'overview', status: 'queued', title: 'Overview' }),
      expect.objectContaining({ id: 'guides/install', status: 'queued', title: 'Install' })
    ]);

    await backend.close();
  });

  it('schedules IA pages depth-first for deterministic time to first page', () => {
    const ia: Ia = {
      version: 1,
      nav: [
        {
          id: 'first',
          title: 'First',
          children: [
            { id: 'intro', title: 'Intro' },
            {
              id: 'deep',
              title: 'Deep',
              children: [{ id: 'leaf', title: 'Leaf', path: 'custom/leaf.mdx' }]
            }
          ]
        },
        { id: 'second', title: 'Second' }
      ]
    };

    expect(schedulePagesFromIa(ia).map((page) => [page.id, page.slug, page.order])).toEqual([
      ['first/intro', 'first/intro.mdx', 0],
      ['first/deep/leaf', 'custom/leaf.mdx', 1],
      ['second', 'second.mdx', 2]
    ]);
  });

  it('resumes persisted runs without resetting page progress', async () => {
    await withTempDir(async (dir) => {
      const dbPath = join(dir, 'state.sqlite');
      const firstBackend = createLocalBackend(openDocstubeDatabase(dbPath));
      await initializeRunFromConfigFamily({
        backend: firstBackend,
        workspaceDir: fixturesDir,
        runId: 'run-resume',
        now: () => timestamp
      });
      const overview = await firstBackend.getPage('overview');
      await firstBackend.upsertPage({ ...overview!, status: 'running', updatedAt: laterTimestamp });
      await firstBackend.close();

      const secondBackend = createLocalBackend(openDocstubeDatabase(dbPath));
      const resumed = await initializeRunFromConfigFamily({
        backend: secondBackend,
        workspaceDir: fixturesDir,
        runId: 'run-resume',
        now: () => '2026-06-16T01:00:00.000Z'
      });

      expect(resumed.resumed).toBe(true);
      expect(await secondBackend.getRun('run-resume')).toMatchObject({ startedAt: timestamp });
      expect(await secondBackend.getPage('overview')).toMatchObject({ status: 'running', updatedAt: laterTimestamp });
      await secondBackend.close();
    });
  });

  it('models terminal progress and cap-freeze transitions', async () => {
    const backend = createLocalBackend(openDocstubeDatabase(':memory:'));
    const initialized = await initializeRunFromConfigFamily({
      backend,
      workspaceDir: fixturesDir,
      runId: 'run-caps',
      now: () => timestamp
    });

    await transitionRunStatus({ backend, runId: 'run-caps', status: 'running', now: () => laterTimestamp });
    const frozen = await freezeRunForCaps({
      backend,
      runId: 'run-caps',
      note: 'Usage cap reached with safety margin.',
      now: () => '2026-06-16T00:06:00.000Z'
    });
    const progress = createTerminalProgressState(frozen, initialized.pages);
    expect(progress).toMatchObject({
      runId: 'run-caps',
      status: 'running',
      capFrozen: true,
      totalPages: 2,
      nextPageId: 'overview',
      counts: { queued: 2 }
    });

    const resumed = await resumeRunAfterCapIncrease({
      backend,
      runId: 'run-caps',
      now: () => '2026-06-16T00:07:00.000Z'
    });
    expect(resumed).toMatchObject({ status: 'queued', capFrozen: false, note: undefined });

    await backend.close();
  });
});
