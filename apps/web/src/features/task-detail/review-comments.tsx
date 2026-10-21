import type { ReviewCommentDTO, TaskDetailDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { DELIVERY_COPY as C } from '../../copy/delivery.ts';
import { reviewCommentsQuery, useReviseFromReview } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

function CommentItem({
  comment,
  checked,
  onChange,
}: {
  comment: ReviewCommentDTO;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const where = comment.path === null ? C.reviewGeneral : C.reviewAt(comment.path, comment.line);
  return (
    <li className={styles.reviewComment}>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={comment.path === null ? undefined : 'mono'}>{where}</span>
      </label>
      <ExternalLink href={comment.url}>{C.reviewOnPlatform}</ExternalLink>
      <ol className={styles.reviewMessages}>
        {comment.messages.map((m) => (
          <li key={`${m.author}-${m.createdAt}`}>
            <span className={styles.stepTitle}>{m.author}</span>
            <Markdown source={m.body} />
          </li>
        ))}
      </ol>
    </li>
  );
}

/**
 * Review comments of the pull request the task was delivered as (21 §9): fetched when the user asks, chosen, and
 * handed to the AI with an optional note.
 */
export function ReviewComments({ task }: { task: TaskDetailDTO }) {
  const comments = useQuery(reviewCommentsQuery(task.id));
  const revise = useReviseFromReview();
  const [note, setNote] = useState('');
  // The user's choice holds for the comments it was made on; a new fetch starts from the defaults again.
  const [choice, setChoice] = useState<{ fetchedAt: number; ids: readonly string[] }>();
  const items = comments.data?.items ?? [];
  const selected =
    choice !== undefined && choice.fetchedAt === comments.dataUpdatedAt
      ? choice.ids
      : items.filter((c) => c.selectedByDefault).map((c) => c.id);
  const toggle = (id: string, on: boolean) =>
    setChoice({
      fetchedAt: comments.dataUpdatedAt,
      ids: on ? [...selected, id] : selected.filter((s) => s !== id),
    });
  const send = () =>
    revise.mutate(
      { id: task.id, commentIds: [...selected], ...(note.trim() === '' ? {} : { note: note.trim() }) },
      { onSuccess: () => toast(C.reviewRevised) },
    );

  return (
    <section className={styles.block} data-testid="review-comments">
      <div className={styles.blockHead}>
        <h3 className="sec-t grow">{C.reviewTitle}</h3>
        <Button size="sm" pending={comments.isFetching} onClick={() => void comments.refetch()}>
          {comments.data === undefined ? C.reviewFetch : C.reviewRefetch}
        </Button>
      </div>
      {comments.isError && <ErrorState error={comments.error} />}
      {comments.data === undefined ? (
        <p className="hint">{C.reviewIntro}</p>
      ) : items.length === 0 ? (
        <p className="hint">{C.reviewEmpty}</p>
      ) : (
        <div className="col">
          <ul className={styles.reviewComments}>
            {items.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                checked={selected.includes(c.id)}
                onChange={(on) => toggle(c.id, on)}
              />
            ))}
          </ul>
          <div className="field">
            <label className="label" htmlFor="review-note">
              {C.reviewNote}
            </label>
            <textarea
              id="review-note"
              className="textarea"
              rows={2}
              placeholder={C.reviewNotePlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              icon="sparkle"
              pending={revise.isPending}
              disabled={selected.length === 0}
              onClick={send}
            >
              {C.reviewRevise}
            </Button>
            <span className="hint">{C.reviewSelected(selected.length)}</span>
          </div>
          {revise.isError && <ErrorState error={revise.error} />}
        </div>
      )}
    </section>
  );
}
