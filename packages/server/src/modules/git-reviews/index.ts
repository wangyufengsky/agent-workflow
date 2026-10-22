import { type CommitDraftsDeps, createCommitDrafts } from './git-reviews.drafts.ts';
import { gitReviewOperations } from './git-reviews.operations.ts';
import { createGitReviewsService, type GitReviewsServiceDeps } from './git-reviews.service.ts';

export type { CommitDrafts } from './git-reviews.drafts.ts';
export type { GitReviewsService } from './git-reviews.service.ts';
export { gitReviewsTable } from './git-reviews.table.ts';

/** AI reviews and commit message drafts of the Git workbench (27 §4, §7.3). */
export function createGitReviewsModule(deps: GitReviewsServiceDeps & CommitDraftsDeps) {
  const service = createGitReviewsService(deps);
  const drafts = createCommitDrafts(deps);
  return { service, drafts, operations: gitReviewOperations(service, drafts) };
}
