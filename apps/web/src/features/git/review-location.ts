import { type GitReviewDTO, GitReviewTarget, type GitReviewTargetInput } from '@aw/shared';

/** Search params of the workbench page (`/git/:projectId`) that show a review. */
export type ReviewSearch =
  | { view: 'changes'; tab: 'review' }
  | { view: 'commits'; sha: string; parent?: number; tab: 'review' }
  | { view: 'review'; review: string };

/**
 * Where a review is shown (27 §4.5): the worktree's in the changes view (it has no commit to diff against), a
 * commit's in its detail against the same parent, the others in the review view.
 */
export function reviewSearch(review: GitReviewDTO): ReviewSearch {
  switch (review.target) {
    case GitReviewTarget.Worktree:
      return { view: 'changes', tab: 'review' };
    case GitReviewTarget.Commit:
      return {
        view: 'commits',
        sha: review.to ?? review.from,
        ...(review.parent === null || review.parent === 1 ? {} : { parent: review.parent }),
        tab: 'review',
      };
    case GitReviewTarget.Branch:
    case GitReviewTarget.Range:
      return { view: 'review', review: review.id };
  }
}

/** What reviewing again looks at: the same diff, a merge commit against the same parent. */
export function reviewTarget(review: GitReviewDTO): GitReviewTargetInput {
  switch (review.target) {
    case GitReviewTarget.Worktree:
      return { kind: review.target };
    case GitReviewTarget.Commit:
      return {
        kind: review.target,
        sha: review.to ?? review.from,
        ...(review.parent === null ? {} : { parent: review.parent }),
      };
    case GitReviewTarget.Branch:
      return { kind: review.target, branch: review.label };
    case GitReviewTarget.Range:
      return { kind: review.target, from: review.from, to: review.to ?? review.from };
  }
}
