import type { DbConnectionDTO } from '@aw/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { dbConnectionsTable, projectDbConnectionsTable } from './databases.table.ts';

type ConnectionRow = typeof dbConnectionsTable.$inferSelect;

/** A connection with the id of its stored password. */
export type DbConnection = DbConnectionDTO & { credentialId: string };

/** Undefined fields are left unchanged. */
export type DbConnectionChanges = {
  [K in 'name' | 'type' | 'host' | 'port' | 'database' | 'username' | 'tlsMode']?: ConnectionRow[K] | undefined;
} & { updatedAt: number };

export function createDatabasesRepo(db: DbExecutor) {
  const t = dbConnectionsTable;
  const links = projectDbConnectionsTable;
  return {
    list(): DbConnection[] {
      return db.select().from(t).orderBy(asc(t.createdAt)).all();
    },
    find(id: string): DbConnection | undefined {
      return db.select().from(t).where(eq(t.id, id)).get();
    },
    findByName(name: string): DbConnection | undefined {
      return db.select().from(t).where(eq(t.name, name)).get();
    },
    insert(connection: DbConnection): void {
      db.insert(t).values(connection).run();
    },
    update(id: string, changes: DbConnectionChanges): void {
      db.update(t).set(changes).where(eq(t.id, id)).run();
    },
    delete(id: string): void {
      db.delete(t).where(eq(t.id, id)).run();
    },
    /** The project's connections, in the order they were added. */
    listByProject(projectId: string): DbConnection[] {
      return db
        .select({ c: t })
        .from(links)
        .innerJoin(t, eq(t.id, links.dbConnectionId))
        .where(eq(links.projectId, projectId))
        .orderBy(asc(t.createdAt))
        .all()
        .map((r) => r.c);
    },
    setProjectLinks(projectId: string, connectionIds: readonly string[]): void {
      db.delete(links).where(eq(links.projectId, projectId)).run();
      for (const dbConnectionId of new Set(connectionIds)) db.insert(links).values({ projectId, dbConnectionId }).run();
    },
  };
}
