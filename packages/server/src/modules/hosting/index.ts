import { createHostingAccountsService, type HostingAccountsServiceDeps } from './hosting.accounts.ts';
import { hostingOperations } from './hosting.operations.ts';

export { type HostingAccountsService, normalizeBaseUrl } from './hosting.accounts.ts';
export { createHostingProvider, type HostingEndpoints, PUBLIC_HOSTING } from './hosting.provider.ts';
export type { GitHostingProvider, OpenPullRequest, PlatformReviewComment, PullRequestInput } from './hosting.types.ts';

export function createHostingModule(deps: HostingAccountsServiceDeps) {
  const service = createHostingAccountsService(deps);
  return { service, operations: hostingOperations(service) };
}
