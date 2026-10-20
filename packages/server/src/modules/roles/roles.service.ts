import { randomUUID } from 'node:crypto';
import type { RoleSeed } from '@aw/builtin';
import { AppError, ErrorCode, type RoleDTO, RoleKind, type UpdateRoleRequest } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import { createRolesRepo } from './roles.repo.ts';

export type RolesServiceDeps = { db: Db; clock: Clock; log: Logger };

export function createRolesService({ db, clock, log }: RolesServiceDeps) {
  const repo = createRolesRepo(db);

  function get(id: string): RoleDTO {
    const role = repo.find(id);
    if (role === undefined) throw new AppError(ErrorCode.RoleNotFound, `Role ${id} not found`, { id });
    return role;
  }

  return {
    list: (): RoleDTO[] => repo.list(),
    get,

    /** A workflow or plan names roles by key; an unknown key is a real possibility for custom workflows. */
    getByKey(key: string): RoleDTO {
      const role = repo.findByKey(key);
      if (role === undefined) throw new AppError(ErrorCode.RoleNotFound, `Role ${key} not found`, { key });
      return role;
    },

    /** Writes the built-in roles of this app version (13): new ones are added, changed ones updated in place. */
    syncBuiltin(seeds: readonly RoleSeed[]): void {
      const now = clock.now();
      db.transaction((tx) => {
        const txRepo = createRolesRepo(tx);
        for (const seed of seeds) {
          const content = { name: seed.name, description: seed.description, prompt: seed.prompt };
          const existing = txRepo.findByKey(seed.key);
          if (existing === undefined) {
            txRepo.insert({
              id: randomUUID(),
              key: seed.key,
              kind: RoleKind.Builtin,
              baseAgent: seed.baseAgent,
              model: null,
              ...content,
              createdAt: now,
              updatedAt: now,
            });
            log.info({ role: seed.key }, 'builtin role added');
          } else if (
            existing.name !== content.name ||
            existing.description !== content.description ||
            existing.prompt !== content.prompt
          ) {
            txRepo.update(existing.id, { ...content, updatedAt: now });
            log.info({ role: seed.key }, 'builtin role updated');
          }
        }
      });
    },

    update({ id, ...changes }: UpdateRoleRequest): RoleDTO {
      const role = get(id);
      if (role.kind === RoleKind.Builtin) {
        throw new AppError(ErrorCode.RoleReadonly, 'Built-in roles are read-only; copy the role to change it', { id });
      }
      repo.update(id, { ...changes, updatedAt: clock.now() });
      return get(id);
    },
  };
}
export type RolesService = ReturnType<typeof createRolesService>;
