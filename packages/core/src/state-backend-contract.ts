import { parseDocstubeConfig } from '@docstube/contracts';
import type { DocstubeConfig, FeedbackRecord, Finding, Ia } from '@docstube/contracts';
import { describe, expect, it } from 'vitest';
import {
  STATE_BACKEND_VERSION,
  StateBackendError,
  type PageDetail,
  type RunRecord,
  type StateBackend
} from './state-backend.ts';

// Reusable `StateBackend` contract test suite.
//
// Any backend (the local SQLite backend now, a hosted backend later) must pass this suite. Each
// test builds a fresh backend so cases stay isolated. The suite proves the persisted shapes match
// the frozen contracts and that review actions behave as specified.

const ts = '2026-06-16T00:00:00.000Z';

const sampleConfig: DocstubeConfig = parseDocstubeConfig({
  site: { name: 'Acme Toolkit' },
  docsType: 'library',
  personas: [{ id: 'developer', title: 'Application developer' }],
  agents: { writer: { adapter: 'codex' } }
});

const sampleIa: Ia = {
  version: 1,
  nav: [{ id: 'overview', title: 'Overview', brief: 'What the toolkit is' }]
};

const sampleFinding: Finding = {
  code: 'mdx-compile',
  severity: 'major',
  origin: 'verifier',
  message: 'unterminated JSX expression'
};

const sampleRun: RunRecord = {
  id: 'run-1',
  status: 'running',
  capFrozen: false,
  startedAt: ts,
  updatedAt: ts
};

const flaggedPage: PageDetail = {
  id: 'overview',
  runId: 'run-1',
  title: 'Overview',
  status: 'flagged',
  approved: false,
  slug: 'overview',
  findings: [sampleFinding],
  updatedAt: ts
};

const sampleFeedback: FeedbackRecord = {
  id: 'feedback-1',
  createdAt: ts,
  scope: 'page',
  message: 'The intro buries the install step.',
  pageId: 'overview',
  category: 'uncategorized',
  status: 'open'
};

export const runStateBackendContract = (label: string, makeBackend: () => Promise<StateBackend>): void => {
  describe(`StateBackend contract: ${label}`, () => {
    it('reports the contract version', async () => {
      const backend = await makeBackend();
      expect(backend.version).toBe(STATE_BACKEND_VERSION);
      await backend.close();
    });

    it('returns null config before one is written', async () => {
      const backend = await makeBackend();
      expect(await backend.getConfig()).toBeNull();
      await backend.close();
    });

    it('round-trips the config family', async () => {
      const backend = await makeBackend();
      await backend.setConfig(sampleConfig);
      expect(await backend.getConfig()).toEqual(sampleConfig);

      // setConfig is an upsert: a second write replaces the first.
      const renamed = parseDocstubeConfig({ ...sampleConfig, site: { name: 'Renamed Toolkit' } });
      await backend.setConfig(renamed);
      expect((await backend.getConfig())?.site.name).toBe('Renamed Toolkit');
      await backend.close();
    });

    it('reads and replaces theme tokens', async () => {
      const backend = await makeBackend();
      expect(await backend.getThemeTokens()).toEqual({});

      await backend.setThemeTokens({ 'color-accent': '#3b82f6', 'radius-base': 8 });
      expect(await backend.getThemeTokens()).toEqual({ 'color-accent': '#3b82f6', 'radius-base': 8 });

      // A write replaces the full set rather than merging.
      await backend.setThemeTokens({ 'color-accent': '#10b981' });
      expect(await backend.getThemeTokens()).toEqual({ 'color-accent': '#10b981' });
      await backend.close();
    });

    it('lists IA proposals', async () => {
      const backend = await makeBackend();
      expect(await backend.listIaProposals()).toEqual([]);

      await backend.saveIaProposal({ id: 'proposal-1', runId: 'run-1', ia: sampleIa, createdAt: ts });
      const proposals = await backend.listIaProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.ia).toEqual(sampleIa);
      await backend.close();
    });

    it('stores and reads run status', async () => {
      const backend = await makeBackend();
      expect(await backend.getRun('run-1')).toBeNull();

      await backend.saveRun(sampleRun);
      const run = await backend.getRun('run-1');
      expect(run?.status).toBe('running');
      expect(run?.capFrozen).toBe(false);

      await backend.saveRun({ ...sampleRun, status: 'completed', capFrozen: true });
      const updated = await backend.getRun('run-1');
      expect(updated?.status).toBe('completed');
      expect(updated?.capFrozen).toBe(true);
      await backend.close();
    });

    it('lists pages and reads page detail with findings', async () => {
      const backend = await makeBackend();
      await backend.upsertPage(flaggedPage);
      await backend.upsertPage({
        ...flaggedPage,
        id: 'guides/install',
        title: 'Install',
        status: 'passed',
        findings: []
      });

      const all = await backend.listPages();
      expect(all).toHaveLength(2);

      const scoped = await backend.listPages('run-1');
      expect(scoped.map((page) => page.id).toSorted()).toEqual(['guides/install', 'overview']);

      const detail = await backend.getPage('overview');
      expect(detail?.status).toBe('flagged');
      expect(detail?.findings).toEqual([sampleFinding]);
      expect(await backend.getPage('missing')).toBeNull();
      await backend.close();
    });

    it('submits and lists feedback', async () => {
      const backend = await makeBackend();
      const stored = await backend.submitFeedback(sampleFeedback);
      expect(stored.id).toBe('feedback-1');
      expect(stored.category).toBe('uncategorized');

      expect(await backend.listFeedback('overview')).toHaveLength(1);
      expect(await backend.listFeedback('other-page')).toHaveLength(0);
      await backend.close();
    });

    it('approves a page', async () => {
      const backend = await makeBackend();
      await backend.upsertPage({ ...flaggedPage, status: 'passed', findings: [] });
      const approved = await backend.approvePage('overview');
      expect(approved.approved).toBe(true);
      expect((await backend.getPage('overview'))?.approved).toBe(true);
      await backend.close();
    });

    it('regenerates a page back to queued and clears findings', async () => {
      const backend = await makeBackend();
      await backend.upsertPage(flaggedPage);
      const regenerated = await backend.regeneratePage('overview');
      expect(regenerated.status).toBe('queued');
      expect(regenerated.approved).toBe(false);
      expect(regenerated.findings).toEqual([]);
      await backend.close();
    });

    it('throws a structured not_found error for missing pages', async () => {
      const backend = await makeBackend();
      await expect(backend.approvePage('missing')).rejects.toBeInstanceOf(StateBackendError);
      await expect(backend.regeneratePage('missing')).rejects.toMatchObject({ code: 'not_found' });
      await backend.close();
    });
  });
};
