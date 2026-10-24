import { initiativesOperations } from './initiatives.operations.ts';
import { createInitiativesService, type InitiativesServiceDeps } from './initiatives.service.ts';

export type { InitiativesService } from './initiatives.service.ts';

export function createInitiativesModule(deps: InitiativesServiceDeps) {
  const service = createInitiativesService(deps);
  return { service, operations: initiativesOperations(service) };
}
