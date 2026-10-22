import {
  getGitReviewOp,
  gitDraftCommitMessageOp,
  listGitReviewsOp,
  startGitReviewOp,
  stopGitReviewOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { CommitDrafts } from './git-reviews.drafts.ts';
import type { GitReviewsService } from './git-reviews.service.ts';

export function gitReviewOperations(reviews: GitReviewsService, drafts: CommitDrafts) {
  return [
    implement(startGitReviewOp, ({ id, target, focus }) => reviews.start(id, target, focus)),
    implement(listGitReviewsOp, ({ id, to }) => ({ items: reviews.list(id, to) })),
    implement(getGitReviewOp, ({ reviewId }) => reviews.get(reviewId)),
    implement(stopGitReviewOp, ({ reviewId }) => reviews.stop(reviewId)),
    implement(gitDraftCommitMessageOp, ({ id, from, to }) =>
      drafts.draft(id, from === undefined || to === undefined ? undefined : { from, to }),
    ),
  ];
}
