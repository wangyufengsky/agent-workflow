import { inboxOperations } from './inbox.operations.ts';
import { createInboxService, type InboxServiceDeps } from './inbox.service.ts';

export type { InboxScope } from './inbox.repo.ts';
export type { InboxService, NewInboxItem } from './inbox.service.ts';
export { inboxItemsTable } from './inbox.table.ts';

export function createInboxModule(deps: InboxServiceDeps) {
  const service = createInboxService(deps);
  return { service, operations: inboxOperations(service) };
}
