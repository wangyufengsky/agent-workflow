import { changeMasterPasswordOp, resetMasterPasswordOp, setupMasterPasswordOp, unlockCredentialsOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { CredentialsService } from './credentials.service.ts';

export function credentialsOperations(credentials: CredentialsService) {
  return [
    implement(setupMasterPasswordOp, ({ password }) => credentials.setupMasterPassword(password)),
    implement(unlockCredentialsOp, ({ password }) => credentials.unlock(password)),
    implement(changeMasterPasswordOp, ({ currentPassword, newPassword }) =>
      credentials.changeMasterPassword(currentPassword, newPassword),
    ),
    implement(resetMasterPasswordOp, () => credentials.resetMasterPassword()),
  ];
}
