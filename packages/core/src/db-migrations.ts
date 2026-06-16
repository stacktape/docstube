import Database from 'better-sqlite3';

// Migration creation and application for the local `.docstube/db.sqlite` database.
//
// Migrations are hand-authored SQL kept in sync with `db-schema.ts`. They are applied in order and
// tracked in `__docstube_migrations`, so applying them to a fresh database creates every table and
// re-applying is a no-op. This avoids depending on a generation step at runtime while keeping a
// deterministic, testable migration path.

export type SqliteDatabase = Database.Database;

export type Migration = {
  name: string;
  sql: string;
};

const MIGRATIONS_TABLE = '__docstube_migrations';

export const migrations: readonly Migration[] = [
  {
    name: '0001_initial',
    sql: `
      CREATE TABLE app_config (
        id TEXT PRIMARY KEY NOT NULL,
        config TEXT NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        cap_frozen INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE pages (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT,
        status TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        findings TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE feedback (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        page_id TEXT,
        section_id TEXT,
        selector TEXT,
        category TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE ia_proposals (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT,
        label TEXT,
        ia TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE theme_tokens (
        name TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `
  }
];

export type MigrateResult = {
  applied: string[];
};

// Apply any pending migrations in order, recording each in `__docstube_migrations`. Idempotent:
// already-applied migrations are skipped and a fully migrated database yields an empty result.
export const migrate = (db: SqliteDatabase, now: () => string = () => new Date().toISOString()): MigrateResult => {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );`
  );

  const existing = db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all() as ReadonlyArray<{ name: string }>;
  const done = new Set(existing.map((row) => row.name));
  const record = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`);
  const applied: string[] = [];

  const apply = db.transaction(() => {
    for (const migration of migrations) {
      if (done.has(migration.name)) {
        continue;
      }

      db.exec(migration.sql);
      record.run(migration.name, now());
      applied.push(migration.name);
    }
  });

  apply();
  return { applied };
};

export type OpenDatabaseOptions = {
  now?: () => string;
};

// Open a better-sqlite3 database and apply migrations. Defaults to an in-memory database for tests
// and ephemeral use; pass a path such as `.docstube/db.sqlite` for durable local state.
export const openDocstubeDatabase = (filename = ':memory:', options: OpenDatabaseOptions = {}): SqliteDatabase => {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, options.now);
  return db;
};
