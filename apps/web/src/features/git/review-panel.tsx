import { AttemptStatus, type GitFindingDTO, type GitReviewDTO, type GitReviewTargetInput } from '@aw/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Elapsed } from '../../components/elapsed.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { STREAM_COPY } from '../../copy/attempts.ts';
import { formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import styles from './git.module.css';
import { useStartReview, useStopReview } from './git.queries.ts';
import { isActiveReview } from './git-parts.tsx';
import { ReviewResult } from './review-result.tsx';

function StartReview({
  projectId,
  target,
  again,
  onStarted,
}: {
  projectId: string;
  target: GitReviewTargetInput;
  again: boolean;
  onStarted: (id: string) => void;
}) {
  const [focus, setFocus] = useState('');
  const start = useStartReview(projectId);
  return (
    <div className={`card ${styles.startReview}`}>
      <p className="hint">{C.reviewStartHint}</p>
      <div className="field">
        <label className="label" htmlFor="review-focus">
          {C.reviewFocus}
        </label>
        <input
          id="review-focus"
          className="input"
          placeholder={C.reviewFocusPlaceholder}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />
      </div>
      <div className="row">
        <Button
          variant="brand"
          icon="sparkle"
          pending={start.isPending}
          onClick={() =>
            start.mutate(
              { target, ...(focus.trim() === '' ? {} : { focus: focus.trim() }) },
              { onSuccess: (review) => onStarted(review.id) },
            )
          }
        >
          {again ? C.reviewAgain : C.reviewRun}
        </Button>
      </div>
      {start.isError && <ErrorState error={start.error} />}
    </div>
  );
}

/**
 * An AI review of one diff (27 §4.5): start one, watch it run, read its verdict and findings, jump to a finding's
 * line, and turn the chosen findings into a fix task.
 */
export function ReviewPanel({
  projectId,
  target,
  reviews,
  selectedReviewId,
  onSelectReview,
  onLocate,
}: {
  projectId: string;
  target: GitReviewTargetInput;
  /** Reviews of this diff, newest first. */
  reviews: readonly GitReviewDTO[];
  selectedReviewId?: string | undefined;
  onSelectReview?: (id: string) => void;
  onLocate?: ((finding: GitFindingDTO) => void) | undefined;
}) {
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const selectReview = onSelectReview ?? setPickedId;
  const stop = useStopReview(projectId);
  const review = reviews.find((r) => r.id === (selectedReviewId ?? pickedId)) ?? reviews[0];
  // The assistant is told which review the user is looking at (15 §2), not only which view.
  const setShownGitReview = useUiStore((s) => s.setShownGitReview);
  const shownId = review?.id;
  useEffect(() => {
    if (shownId === undefined) return;
    setShownGitReview(shownId);
    return () => setShownGitReview(null);
  }, [shownId, setShownGitReview]);
  if (review === undefined)
    return <StartReview projectId={projectId} target={target} again={false} onStarted={selectReview} />;
  const index = reviews.length - reviews.indexOf(review);
  const running = isActiveReview(review);
  return (
    <div className={styles.review} data-testid="git-review">
      <div className={styles.reviewTop}>
        {reviews.length > 1 ? (
          <select
            className="select fit"
            aria-label={C.reviewStart}
            value={review.id}
            onChange={(e) => selectReview(e.target.value)}
          >
            {reviews.map((r, i) => (
              <option key={r.id} value={r.id}>
                {C.reviewOf(reviews.length - i, formatDateTime(r.createdAt))}
              </option>
            ))}
          </select>
        ) : (
          <span>{C.reviewOf(index, formatDateTime(review.createdAt))}</span>
        )}
        <span className={styles.spacer} />
        {running && <Elapsed since={review.createdAt} />}
        {running && (
          <Button size="sm" icon="stop" pending={stop.isPending} onClick={() => stop.mutate(review.id)}>
            {C.reviewStop}
          </Button>
        )}
      </div>
      <AttemptView
        key={review.attemptId}
        attemptId={review.attemptId}
        title={STREAM_COPY.reviewTitle}
        canAbort={false}
        foldOnEnd
      />
      {(review.status === AttemptStatus.Failed || review.status === AttemptStatus.Interrupted) && (
        <div className="banner warn" role="status">
          <Icon name="alert" />
          <div>{C.reviewFailed}</div>
        </div>
      )}
      {review.status === AttemptStatus.Aborted && <p className="hint">{C.reviewStopped}</p>}
      {review.status === AttemptStatus.Succeeded && (
        <ReviewResult key={review.id} review={review} projectId={projectId} onLocate={onLocate} />
      )}
      {!running && <StartReview projectId={projectId} target={target} again onStarted={selectReview} />}
    </div>
  );
}
