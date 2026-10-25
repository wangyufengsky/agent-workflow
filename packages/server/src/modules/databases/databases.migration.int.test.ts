import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DbTlsMode } from '@aw/shared';
import { expect, it } from 'vitest';
import { openDatabase } from '../../core/db/database.ts';

const MIGRATIONS = join(import.meta.dirname, '../../../migrations');
const TLS_MODE_MIGRATION = '0030_db_tls_mode';

/**
 * The migrations folder as it was before `migration`: without it and every later one, since drizzle skips a migration
 * older than the newest one already applied.
 */
async function migrationsBefore(migration: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aw-migrations-'));
  await cp(MIGRATIONS, dir, { recursive: true });
  const journalFile = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(await readFile(journalFile, 'utf8'));
  const index = journal.entries.findIndex((e) => e.tag === migration);
  for (const e of journal.entries.slice(index)) await rm(join(dir, `${e.tag}.sql`));
  await writeFile(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }));
  return dir;
}

it('数据库连接原来勾选的 TLS 迁移为校验证书，没勾选的为不加密（D166）', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'aw-db-')), 'app.db');
  openDatabase(file, await migrationsBefore(TLS_MODE_MIGRATION)).close();
  const raw = new DatabaseSync(file);
  raw.exec(`INSERT INTO credentials (id, kind, ciphertext, created_at) VALUES ('c', 'db_password', x'00', 0);
    INSERT INTO db_connections (id, name, type, host, port, database, username, credential_id, tls, created_at, updated_at)
    VALUES ('a', 'with-tls', 'mysql', 'h', 3306, 'd', 'u', 'c', 1, 0, 0),
           ('b', 'plain', 'mysql', 'h', 3306, 'd', 'u', 'c', 0, 0, 0);`);
  raw.close();

  openDatabase(file, MIGRATIONS).close();
  const migrated = new DatabaseSync(file);
  expect(migrated.prepare('SELECT name, tls_mode AS tlsMode FROM db_connections ORDER BY id').all()).toEqual([
    { name: 'with-tls', tlsMode: DbTlsMode.Verify },
    { name: 'plain', tlsMode: DbTlsMode.Off },
  ]);
  migrated.close();
});
