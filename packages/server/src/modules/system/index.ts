import { systemOperations } from './system.operations.ts';
import { createSystemService, type SystemServiceDeps } from './system.service.ts';

export type { SystemService } from './system.service.ts';

export function createSystemModule(deps: SystemServiceDeps) {
  const service = createSystemService(deps);
  return { service, operations: systemOperations(service) };
}
