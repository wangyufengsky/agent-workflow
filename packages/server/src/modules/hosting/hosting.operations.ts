import { listHostingAccountsOp, removeHostingAccountOp, setHostingAccountOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { HostingAccountsService } from './hosting.accounts.ts';

export function hostingOperations(accounts: HostingAccountsService) {
  return [
    implement(listHostingAccountsOp, () => ({ items: accounts.list() })),
    implement(setHostingAccountOp, (input) => accounts.set(input)),
    implement(removeHostingAccountOp, ({ id }) => accounts.remove(id)),
  ];
}
