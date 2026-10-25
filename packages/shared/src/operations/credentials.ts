import { z } from 'zod';
import {
  changeMasterPasswordRequestSchema,
  credentialStatusSchema,
  setupMasterPasswordRequestSchema,
  unlockCredentialsRequestSchema,
} from '../contracts/api/system.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// The master password protects credentials where the OS has no key store (D167). The assistant never handles it.

export const setupMasterPasswordOp = defineOperationContract({
  id: 'credentials.setupMasterPassword',
  title: 'op.credentials.setupMasterPassword',
  description: 'Set a master password that encrypts tokens and passwords when the OS has no key store',
  input: setupMasterPasswordRequestSchema,
  output: credentialStatusSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/credentials/master-password' },
  expose: { palette: false, assistant: false },
  credentialFields: ['password'],
  mode: UiMode.Simple,
});

export const unlockCredentialsOp = defineOperationContract({
  id: 'credentials.unlock',
  title: 'op.credentials.unlock',
  description: 'Enter the master password once per start so stored tokens and passwords can be used',
  input: unlockCredentialsRequestSchema,
  output: credentialStatusSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/credentials/master-password/unlock' },
  expose: { palette: false, assistant: false },
  credentialFields: ['password'],
  mode: UiMode.Simple,
});

export const changeMasterPasswordOp = defineOperationContract({
  id: 'credentials.changeMasterPassword',
  title: 'op.credentials.changeMasterPassword',
  description: 'Change the master password; stored tokens and passwords stay as they are',
  input: changeMasterPasswordRequestSchema,
  output: credentialStatusSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/credentials/master-password' },
  expose: { palette: false, assistant: false },
  credentialFields: ['currentPassword', 'newPassword'],
  mode: UiMode.Simple,
});

export const resetMasterPasswordOp = defineOperationContract({
  id: 'credentials.resetMasterPassword',
  title: 'op.credentials.resetMasterPassword',
  description: 'Forget the master password: tokens and passwords it protected are discarded and must be entered again',
  input: z.object({}),
  output: credentialStatusSchema,
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/credentials/master-password' },
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Simple,
});
