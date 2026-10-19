import { debugOperations } from './debug.operations.ts';
import { createDebugService, type DebugServiceDeps } from './debug.service.ts';

export type { DebugService } from './debug.service.ts';

export function createDebugModule(deps: DebugServiceDeps) {
  const service = createDebugService(deps);
  return { service, operations: debugOperations(service) };
}
