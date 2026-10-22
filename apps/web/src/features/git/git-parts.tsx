import { AttemptStatus, type DiffFile, DiffFileStatus, FindingSeverity, type GitReviewDTO } from '@aw/shared';
import { GIT_COPY as C } from '../../copy/git.ts';
import styles from './git.module.css';

/** The first character of a name, as a small round avatar. */
export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={styles.avatar} data-size={large ? 'lg' : undefined} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const STATUS_LETTER: Record<DiffFile['status'], string> = {
  [DiffFileStatus.Added]: 'A',
  [DiffFileStatus.Modified]: 'M',
  [DiffFileStatus.Deleted]: 'D',
  [DiffFileStatus.Renamed]: 'R',
};

/** A changed file's status letter; an untracked file says「新」. */
export function StatusCode({ status, untracked = false }: { status: DiffFile['status']; untracked?: boolean }) {
  return (
    <span className={styles.code} data-status={untracked ? 'untracked' : status}>
      {untracked ? C.untracked : STATUS_LETTER[status]}
    </span>
  );
}

/** Added / deleted line counts; binary files have none. */
export function LineCounts({ file }: { file: Pick<DiffFile, 'additions' | 'deletions'> }) {
  if (file.additions === null) return null;
  return (
    <span className="row">
      <span className={styles.add}>+{file.additions}</span>
      {file.deletions !== null && file.deletions > 0 && <span className={styles.del}>−{file.deletions}</span>}
    </span>
  );
}

export const isActiveReview = (review: Pick<GitReviewDTO, 'status'>) =>
  review.status === AttemptStatus.Starting || review.status === AttemptStatus.Running;

/** The badge a commit carries in the list after its latest review. */
export function ReviewBadge({ review }: { review: GitReviewDTO }) {
  if (isActiveReview(review)) {
    return (
      <span className={styles.reviewBadge} data-tone="run">
        {C.reviewing}
      </span>
    );
  }
  if (review.status !== AttemptStatus.Succeeded) return null;
  if (review.findings.length === 0) {
    return (
      <span className={styles.reviewBadge} data-tone="ok">
        {C.noIssues}
      </span>
    );
  }
  return <span className={styles.reviewBadge}>{C.issues(review.findings.length)}</span>;
}

/** Findings counted by severity, most severe first. */
export function severityCounts(review: GitReviewDTO): Record<FindingSeverity, number> {
  const counts = { [FindingSeverity.Blocker]: 0, [FindingSeverity.Major]: 0, [FindingSeverity.Minor]: 0 };
  for (const f of review.findings) counts[f.severity] += 1;
  return counts;
}
