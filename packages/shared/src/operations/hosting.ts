import { z } from 'zod';
import { hostingAccountSchema, setHostingAccountRequestSchema } from '../contracts/api/projects.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

export const listHostingAccountsOp = defineOperationContract({
  id: 'hostingAccounts.list',
  title: 'op.hostingAccounts.list',
  description: 'List the global GitHub / GitLab tokens used by projects without a token of their own',
  input: z.object({}),
  output: z.object({ items: z.array(hostingAccountSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/hosting-accounts' },
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Pro,
});

export const setHostingAccountOp = defineOperationContract({
  id: 'hostingAccounts.set',
  title: 'op.hostingAccounts.set',
  description: 'Save (or replace) the global token of a GitHub / GitLab address once the platform accepts it',
  input: setHostingAccountRequestSchema,
  output: hostingAccountSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/hosting-accounts' },
  expose: { palette: false, assistant: false },
  credentialFields: ['token'],
  mode: UiMode.Pro,
});

export const removeHostingAccountOp = defineOperationContract({
  id: 'hostingAccounts.remove',
  title: 'op.hostingAccounts.remove',
  description: 'Delete a global token; projects that used it have no token until one is bound again',
  input: z.object({ id: z.string() }),
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/hosting-accounts/:id' },
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Pro,
});
