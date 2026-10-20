import type { RoleDTO } from '@aw/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { rolesTable } from './roles.table.ts';

/** Undefined fields are left unchanged. */
export type RoleChanges = { [K in 'name' | 'description' | 'prompt' | 'model']?: RoleDTO[K] | undefined } & {
  updatedAt: number;
};

export function createRolesRepo(db: DbExecutor) {
  return {
    list(): RoleDTO[] {
      return db.select().from(rolesTable).orderBy(asc(rolesTable.createdAt)).all();
    },
    find(id: string): RoleDTO | undefined {
      return db.select().from(rolesTable).where(eq(rolesTable.id, id)).get();
    },
    findByKey(key: string): RoleDTO | undefined {
      return db.select().from(rolesTable).where(eq(rolesTable.key, key)).get();
    },
    insert(role: RoleDTO): void {
      db.insert(rolesTable).values(role).run();
    },
    update(id: string, changes: RoleChanges): void {
      db.update(rolesTable).set(changes).where(eq(rolesTable.id, id)).run();
    },
  };
}
