import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, migrations, openDocstubeDatabase } from './db-migrations';

const expectedTables = ['app_config', 'runs', 'pages', 'feedback', 'ia_proposals', 'theme_tokens'];

const tableNames = (db: Database.Database): string[] => {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
};

describe('fresh database migration', () => {
  it('creates every table on a fresh database', () => {
    const db = new Database(':memory:');
    const result = migrate(db);

    expect(result.applied).toEqual(migrations.map((migration) => migration.name));
    const names = tableNames(db);
    for (const table of expectedTables) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('is idempotent when re-applied', () => {
    const db = new Database(':memory:');
    migrate(db);
    const second = migrate(db);

    expect(second.applied).toEqual([]);
    db.close();
  });

  it('openDocstubeDatabase returns a migrated database', () => {
    const db = openDocstubeDatabase(':memory:');
    expect(tableNames(db)).toContain('pages');
    db.close();
  });
});
