import { randomUUID } from 'node:crypto';
import type { RoleSeed } from '@aw/builtin';
import {
  AppError,
  type CreateRoleRequest,
  ErrorCode,
  type RoleDTO,
  RoleKind,
  type UpdateRoleRequest,
} from '@aw/shared';
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
          const content = {
            name: seed.name,
            description: seed.description,
            prompt: seed.prompt,
            baseAgent: seed.baseAgent,
          };
          const existing = txRepo.findByKey(seed.key);
          if (existing === undefined) {
            txRepo.insert({
              id: randomUUID(),
              key: seed.key,
              kind: RoleKind.Builtin,
              model: null,
              ...content,
              createdAt: now,
              updatedAt: now,
            });
            log.info({ role: seed.key }, 'builtin role added');
          } else if (
            existing.name !== content.name ||
            existing.description !== content.description ||
            existing.prompt !== content.prompt ||
            existing.baseAgent !== content.baseAgent
          ) {
            txRepo.update(existing.id, { ...content, updatedAt: now });
            log.info({ role: seed.key }, 'builtin role updated');
          }
        }
      });
    },

    /** A new custom role, or a copy of a role (built-in ones included) under a new key. */
    create({ key, name, copyFrom, ...fields }: CreateRoleRequest): RoleDTO {
      if (repo.findByKey(key) !== undefined) {
        throw new AppError(ErrorCode.RoleAlreadyExists, `Role ${key} already exists`, { key });
      }
      const source = copyFrom === undefined ? undefined : get(copyFrom);
      const baseAgent = fields.baseAgent ?? source?.baseAgent;
      const prompt = fields.prompt ?? source?.prompt;
      // The request schema requires these without copyFrom.
      if (baseAgent === undefined || prompt === undefined) {
        throw new Error('A new role without copyFrom passed validation incomplete');
      }
      const now = clock.now();
      const id = randomUUID();
      repo.insert({
        id,
        key,
        name,
        kind: RoleKind.Custom,
        baseAgent,
        description: fields.description ?? source?.description ?? '',
        prompt,
        model: fields.model === undefined ? (source?.model ?? null) : fields.model,
        createdAt: now,
        updatedAt: now,
      });
      log.info({ role: key }, 'role created');
      return get(id);
    },

    /**
     * Deletes a custom role once `inUse` (the tasks module's check of workflows and task steps) finds no use; throws
     * ROLE_IN_USE with what it found otherwise.
     */
    delete(id: string, inUse: (role: RoleDTO) => Record<string, unknown> | null): void {
      const role = get(id);
      if (role.kind === RoleKind.Builtin) {
        throw new AppError(ErrorCode.RoleReadonly, 'Built-in roles cannot be deleted', { id });
      }
      const uses = inUse(role);
      if (uses !== null) throw new AppError(ErrorCode.RoleInUse, `Role ${role.key} is in use`, uses);
      repo.delete(id);
      log.info({ role: role.key }, 'role deleted');
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
