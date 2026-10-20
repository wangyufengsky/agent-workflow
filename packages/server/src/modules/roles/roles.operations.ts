import { createRoleOp, listRolesOp, updateRoleOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { RolesService } from './roles.service.ts';

export function rolesOperations(roles: RolesService) {
  return [
    implement(listRolesOp, () => ({ items: roles.list() })),
    implement(createRoleOp, (input) => roles.create(input)),
    implement(updateRoleOp, (input) => roles.update(input)),
  ];
}
