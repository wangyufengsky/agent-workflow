import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { settingsTable } from './settings.table.ts';

/** Stored overrides only; keys at their default have no row. Values are raw JSON, parsed by the service. */
export function createSettingsRepo(db: DbExecutor) {
  return {
    readAll(): Record<string, unknown> {
      const rows = db.select().from(settingsTable).all();
      return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    },
    upsert(key: string, value: unknown, now: number): void {
      db.insert(settingsTable)
        .values({ key, value: JSON.stringify(value), updatedAt: now })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: sql`excluded.value`, updatedAt: now } })
        .run();
    },
  };
}
export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
