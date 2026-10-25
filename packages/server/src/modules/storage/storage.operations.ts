import { cleanStorageOp, getStorageOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { StorageService } from './storage.service.ts';

export function storageOperations(storage: StorageService) {
  return [
    implement(getStorageOp, () => storage.usage()),
    implement(cleanStorageOp, ({ target }) => storage.clean(target)),
  ];
}
