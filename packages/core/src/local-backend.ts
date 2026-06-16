import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { feedbackRecordSchema } from '@docstube/contracts';
import type { FeedbackRecord } from '@docstube/contracts';
import { appConfig, feedback, iaProposals, pages, runs, themeTokens } from './db-schema.ts';
import type { SqliteDatabase } from './db-migrations.ts';
import {
  STATE_BACKEND_VERSION,
  StateBackendError,
  type IaProposal,
  type PageDetail,
  type PageSummary,
  type RunRecord,
  type StateBackend,
  type ThemeTokens
} from './state-backend.ts';

// Local SQLite implementation of the `StateBackend` contract.
//
// better-sqlite3 is synchronous; the methods resolve immediately to satisfy the async contract. A
// `now` clock is injectable so tests are deterministic. The same contract test suite that runs
// here will run against a future hosted backend.

export type LocalBackendOptions = {
  now?: () => string;
};

type PageRow = typeof pages.$inferSelect;

const toSummary = (row: PageRow): PageSummary => ({
  id: row.id,
  runId: row.runId,
  title: row.title,
  status: row.status as PageSummary['status'],
  approved: row.approved,
  updatedAt: row.updatedAt
});

const toDetail = (row: PageRow): PageDetail => ({
  ...toSummary(row),
  slug: row.slug ?? undefined,
  findings: row.findings
});

const toFeedbackRecord = (row: typeof feedback.$inferSelect): FeedbackRecord =>
  feedbackRecordSchema.parse({
    id: row.id,
    createdAt: row.createdAt,
    scope: row.scope,
    message: row.message,
    pageId: row.pageId ?? undefined,
    sectionId: row.sectionId ?? undefined,
    selector: row.selector ?? undefined,
    category: row.category,
    status: row.status
  });

export const createLocalBackend = (db: SqliteDatabase, options: LocalBackendOptions = {}): StateBackend => {
  const orm = drizzle(db);
  const now = options.now ?? (() => new Date().toISOString());

  const requirePage = (pageId: string): PageRow => {
    const row = orm.select().from(pages).where(eq(pages.id, pageId)).get();
    if (!row) {
      throw new StateBackendError('not_found', `page not found: ${pageId}`);
    }
    return row;
  };

  return {
    version: STATE_BACKEND_VERSION,

    async getConfig() {
      const row = orm.select().from(appConfig).where(eq(appConfig.id, 'config')).get();
      return row?.config ?? null;
    },

    async setConfig(config) {
      orm
        .insert(appConfig)
        .values({ id: 'config', config })
        .onConflictDoUpdate({ target: appConfig.id, set: { config } })
        .run();
    },

    async listIaProposals() {
      const rows = orm.select().from(iaProposals).all();
      return rows.map(
        (row): IaProposal => ({
          id: row.id,
          runId: row.runId ?? undefined,
          label: row.label ?? undefined,
          ia: row.ia,
          createdAt: row.createdAt
        })
      );
    },

    async saveIaProposal(proposal) {
      orm
        .insert(iaProposals)
        .values({
          id: proposal.id,
          runId: proposal.runId ?? null,
          label: proposal.label ?? null,
          ia: proposal.ia,
          createdAt: proposal.createdAt
        })
        .onConflictDoUpdate({
          target: iaProposals.id,
          set: { runId: proposal.runId ?? null, label: proposal.label ?? null, ia: proposal.ia }
        })
        .run();
      return proposal;
    },

    async getThemeTokens() {
      const rows = orm.select().from(themeTokens).all();
      const tokens: ThemeTokens = {};
      for (const row of rows) {
        tokens[row.name] = row.value;
      }
      return tokens;
    },

    async setThemeTokens(tokens) {
      const replace = db.transaction(() => {
        orm.delete(themeTokens).run();
        for (const [name, value] of Object.entries(tokens)) {
          orm.insert(themeTokens).values({ name, value }).run();
        }
      });
      replace();
    },

    async getRun(runId) {
      const row = orm.select().from(runs).where(eq(runs.id, runId)).get();
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        status: row.status as RunRecord['status'],
        capFrozen: row.capFrozen,
        note: row.note ?? undefined,
        startedAt: row.startedAt,
        updatedAt: row.updatedAt
      };
    },

    async saveRun(run) {
      orm
        .insert(runs)
        .values({
          id: run.id,
          status: run.status,
          capFrozen: run.capFrozen,
          note: run.note ?? null,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt
        })
        .onConflictDoUpdate({
          target: runs.id,
          set: { status: run.status, capFrozen: run.capFrozen, note: run.note ?? null, updatedAt: run.updatedAt }
        })
        .run();
      return run;
    },

    async listPages(runId) {
      const query = orm.select().from(pages);
      const rows = runId ? query.where(eq(pages.runId, runId)).all() : query.all();
      return rows.map(toSummary);
    },

    async getPage(pageId) {
      const row = orm.select().from(pages).where(eq(pages.id, pageId)).get();
      return row ? toDetail(row) : null;
    },

    async upsertPage(page) {
      const values = {
        id: page.id,
        runId: page.runId,
        title: page.title,
        slug: page.slug ?? null,
        status: page.status,
        approved: page.approved,
        findings: page.findings,
        updatedAt: page.updatedAt
      };
      orm
        .insert(pages)
        .values(values)
        .onConflictDoUpdate({
          target: pages.id,
          set: {
            runId: page.runId,
            title: page.title,
            slug: page.slug ?? null,
            status: page.status,
            approved: page.approved,
            findings: page.findings,
            updatedAt: page.updatedAt
          }
        })
        .run();
      return page;
    },

    async submitFeedback(record) {
      const parsed = feedbackRecordSchema.parse(record);
      orm
        .insert(feedback)
        .values({
          id: parsed.id,
          createdAt: parsed.createdAt,
          scope: parsed.scope,
          message: parsed.message,
          pageId: parsed.pageId ?? null,
          sectionId: parsed.sectionId ?? null,
          selector: parsed.selector ?? null,
          category: parsed.category,
          status: parsed.status
        })
        .run();
      return parsed;
    },

    async listFeedback(pageId) {
      const query = orm.select().from(feedback);
      const rows = pageId ? query.where(eq(feedback.pageId, pageId)).all() : query.all();
      return rows.map(toFeedbackRecord);
    },

    async approvePage(pageId) {
      requirePage(pageId);
      orm.update(pages).set({ approved: true, updatedAt: now() }).where(eq(pages.id, pageId)).run();
      return toDetail(requirePage(pageId));
    },

    async regeneratePage(pageId) {
      requirePage(pageId);
      orm
        .update(pages)
        .set({ status: 'queued', approved: false, findings: [], updatedAt: now() })
        .where(eq(pages.id, pageId))
        .run();
      return toDetail(requirePage(pageId));
    },

    async close() {
      db.close();
    }
  };
};
