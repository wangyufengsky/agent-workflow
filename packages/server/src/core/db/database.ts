import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { NodeSqliteClient } from './node-sqlite-client.ts';

function createDrizzle(raw: DatabaseSync) {
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(new NodeSqliteClient(raw), dialect, undefined, {});
  return { dialect, session, db: new BaseSQLiteDatabase('sync', dialect, session, undefined) };
}

/** Synchronous drizzle database: `db.transaction(tx => ...)` commits before returning. */
export type Db = ReturnType<typeof createDrizzle>['db'];
/** A transaction or the database itself; repos accept either so services decide transaction boundaries. */
export type DbExecutor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export type Database = { db: Db; close(): void };

/** The SQLite file in the data directory (03 §7); WAL adds `-wal` and `-shm` next to it. */
export const DATABASE_FILE = 'app.db';

/** Opens (creating if needed) the SQLite file with WAL and foreign keys, and applies pending migrations. */
export function openDatabase(file: string, migrationsDir: string): Database {
  mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { dialect, session, db } = createDrizzle(raw);
  dialect.migrate(readMigrationFiles({ migrationsFolder: migrationsDir }), session, {
    migrationsFolder: migrationsDir,
  });
  return { db, close: () => raw.close() };
}
