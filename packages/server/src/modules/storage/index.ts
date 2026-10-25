import { storageOperations } from './storage.operations.ts';
import { createStorageService, type StorageServiceDeps } from './storage.service.ts';

export type { StorageService } from './storage.service.ts';

export function createStorageModule(deps: StorageServiceDeps) {
  const service = createStorageService(deps);
  return { service, operations: storageOperations(service) };
}
