import { z } from 'zod';
import { inboxItemSchema, inboxResolveResponseSchema, listInboxQuerySchema } from '../contracts/api/inbox.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const common = { expose: { palette: false, assistant: true }, credentialFields: [], mode: UiMode.Simple } as const;

export const listInboxOp = defineOperationContract({
  ...common,
  id: 'inbox.list',
  title: 'op.inbox.list',
  description:
    'Items that need the user (questions, permission requests, acceptances, plans, failures, deliveries), newest first, a page at a time',
  input: listInboxQuerySchema,
  output: z.object({ items: z.array(inboxItemSchema), nextCursor: z.string().nullable() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/inbox' },
});

export const countInboxOp = defineOperationContract({
  ...common,
  id: 'inbox.count',
  title: 'op.inbox.count',
  description: 'Number of open items that need the user',
  input: z.object({}),
  output: z.object({ open: z.number() }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/inbox/count' },
});

export const resolveInboxOp = defineOperationContract({
  ...common,
  id: 'inbox.resolve',
  refs: { id: InputRef.InboxItem },
  title: 'op.inbox.resolve',
  description:
    'Answer an open item with the response its kind expects (answer, permission decision, acceptance, plan decision, retry or cancel)',
  input: z.object({ id: z.string(), response: inboxResolveResponseSchema }),
  output: inboxItemSchema,
  // A failure item's `cancel` cancels the task, and a permission's `always` widens what the AI may do (D27).
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/inbox/:id/resolve' },
});

export const dismissInboxOp = defineOperationContract({
  ...common,
  id: 'inbox.dismiss',
  refs: { id: InputRef.InboxItem },
  title: 'op.inbox.dismiss',
  description: 'Dismiss an open failure or delivery item',
  input: z.object({ id: z.string() }),
  output: inboxItemSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/inbox/:id/dismiss' },
});
