import { type RoleDTO, roleSchema } from '@aw/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { rolesTable } from './roles.table.ts';

/** Undefined fields are left unchanged. */
export type RoleChanges = {
  [K in 'name' | 'description' | 'prompt' | 'model' | 'effort' | 'baseAgent']?: RoleDTO[K] | undefined;
} & {
  updatedAt: number;
};

export function createRolesRepo(db: DbExecutor) {
  return {
    list(): RoleDTO[] {
      return db
        .select()
        .from(rolesTable)
        .orderBy(asc(rolesTable.createdAt))
        .all()
        .map((row) => roleSchema.parse(row));
    },
    find(id: string): RoleDTO | undefined {
      const row = db.select().from(rolesTable).where(eq(rolesTable.id, id)).get();
      return row && roleSchema.parse(row);
    },
    findByKey(key: string): RoleDTO | undefined {
      const row = db.select().from(rolesTable).where(eq(rolesTable.key, key)).get();
      return row && roleSchema.parse(row);
    },
    insert(role: RoleDTO): void {
      db.insert(rolesTable).values(role).run();
    },
    delete(id: string): void {
      db.delete(rolesTable).where(eq(rolesTable.id, id)).run();
    },
    update(id: string, changes: RoleChanges): void {
      db.update(rolesTable).set(changes).where(eq(rolesTable.id, id)).run();
    },
  };
}
