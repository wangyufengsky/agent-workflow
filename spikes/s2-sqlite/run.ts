import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { count, eq } from 'drizzle-orm';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { NodeSqliteClient } from './node-sqlite-client.ts';
import { items } from './schema.ts';

const file = join(mkdtempSync(join(tmpdir(), 'aw-s2-')), 'app.db');
const raw = new DatabaseSync(file);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
const client = new NodeSqliteClient(raw);
const dialect = new SQLiteSyncDialect();
// biome-ignore lint/suspicious/noExplicitAny: spike wiring of drizzle internals
const session = new BetterSQLiteSession(client as any, dialect, undefined, {});
const db = new BaseSQLiteDatabase('sync', dialect, session, undefined);

dialect.migrate(readMigrationFiles({ migrationsFolder: join(import.meta.dirname, 'migrations') }), session, {
  migrationsFolder: '',
});

// Concurrent reader in another thread while we write (WAL lets readers proceed).
const reader = new Worker(
  `const {DatabaseSync}=require('node:sqlite');const {parentPort,workerData}=require('node:worker_threads');
   const d=new DatabaseSync(workerData,{readOnly:true});let reads=0,max=0;const end=Date.now()+1500;
   while(Date.now()<end){const r=d.prepare('select count(*) c from items').get();max=Math.max(max,r.c);reads++}
   parentPort.postMessage({reads,max});`,
  { eval: true, workerData: file },
);

const t0 = performance.now();
for (let batch = 0; batch < 10; batch++) {
  db.transaction((tx) => {
    for (let i = 0; i < 1000; i++) {
      const n = batch * 1000 + i;
      tx.insert(items)
        .values({ id: `i${n}`, n, payload: { tag: `t${n % 7}` } })
        .run();
    }
  });
}
const writeMs = performance.now() - t0;

// Rollback must undo everything inside the failed transaction.
try {
  db.transaction((tx) => {
    tx.insert(items)
      .values({ id: 'rollback-me', n: -1, payload: { tag: 'x' } })
      .run();
    throw new Error('boom');
  });
} catch {}

const total = db.select({ c: count() }).from(items).get();
const one = db.select().from(items).where(eq(items.id, 'i42')).get();
const rolledBack = db.select().from(items).where(eq(items.id, 'rollback-me')).get();
const readerResult = await new Promise((r) => reader.once('message', r));

console.log(
  JSON.stringify({
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    journal: raw.prepare('PRAGMA journal_mode').get(),
    inserted: total?.c,
    writeMs: Math.round(writeMs),
    sample: one,
    rollbackWorked: rolledBack === undefined,
    concurrentReader: readerResult,
  }),
);
process.parentPort?.postMessage('done');
