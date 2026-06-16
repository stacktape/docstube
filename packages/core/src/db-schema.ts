import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { DocstubeConfig, Finding, Ia } from '@docstube/contracts';

// Drizzle schema for the machine-local `.docstube/db.sqlite` database.
//
// This database holds pipeline state only; it is never committed (the manifest under
// `.docstube/manifest.yml` is the portable, committed record). It stores no secrets, transcripts,
// or opaque raw judge scores. Persisted page outcomes reuse the frozen `passed`/`flagged` contract
// statuses; derived quality scores are added through the quality-score contract/migration task.
//
// The hand-authored migrations in `db-migrations.ts` must stay in sync with these table shapes.

// Single-row table holding the validated `docstube.yml` config. `id` is always `'config'`.
export const appConfig = sqliteTable('app_config', {
  id: text('id').primaryKey(),
  config: text('config', { mode: 'json' }).notNull().$type<DocstubeConfig>()
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  capFrozen: integer('cap_frozen', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  startedAt: text('started_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  title: text('title').notNull(),
  slug: text('slug'),
  status: text('status').notNull(),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
  findings: text('findings', { mode: 'json' }).notNull().$type<Finding[]>(),
  updatedAt: text('updated_at').notNull()
});

export const feedback = sqliteTable('feedback', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  scope: text('scope').notNull(),
  message: text('message').notNull(),
  pageId: text('page_id'),
  sectionId: text('section_id'),
  selector: text('selector'),
  category: text('category').notNull(),
  status: text('status').notNull()
});

export const iaProposals = sqliteTable('ia_proposals', {
  id: text('id').primaryKey(),
  runId: text('run_id'),
  label: text('label'),
  ia: text('ia', { mode: 'json' }).notNull().$type<Ia>(),
  createdAt: text('created_at').notNull()
});

export const themeTokens = sqliteTable('theme_tokens', {
  name: text('name').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<string | number>()
});
