import { rolesOperations } from './roles.operations.ts';
import { createRolesService, type RolesServiceDeps } from './roles.service.ts';

export type { RolesService } from './roles.service.ts';
export { rolesTable } from './roles.table.ts';

export function createRolesModule(deps: RolesServiceDeps) {
  const service = createRolesService(deps);
  return { service, operations: rolesOperations(service) };
}
