import { countInboxOp, dismissInboxOp, listInboxOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { InboxService } from './inbox.service.ts';

/** `inbox.resolve` acts on tasks, nodes and sessions, so the tasks module implements it. */
export function inboxOperations(inbox: InboxService) {
  return [
    implement(listInboxOp, (query) => inbox.page(query)),
    implement(countInboxOp, () => ({ open: inbox.countOpen() })),
    implement(dismissInboxOp, ({ id }) => inbox.dismiss(id)),
  ];
}
