import {
  AttemptStatus,
  FindingSeverity,
  type GitFindingDTO,
  type GitReviewDTO,
  GitReviewTarget,
  type GitReviewTargetInput,
} from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Elapsed } from '../../components/elapsed.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { STREAM_COPY } from '../../copy/attempts.ts';
import { formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import styles from './git.module.css';
import { useStartReview, useStopReview } from './git.queries.ts';
import { isActiveReview, severityCounts } from './git-parts.tsx';

const SEVERITIES = [FindingSeverity.Blocker, FindingSeverity.Major, FindingSeverity.Minor] as const;
const bySeverity = (a: GitFindingDTO, b: GitFindingDTO) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

const location = (f: GitFindingDTO) =>
  f.line === undefined ? f.path : `${f.path}:${f.line}${f.end_line === undefined ? '' : `-${f.end_line}`}`;

/** The requirement 「据此修复」 prefills (27 §4.6): each chosen finding with its place and suggestion. */
function fixRequirement(review: GitReviewDTO, findings: readonly GitFindingDTO[]): string {
  const items = findings.map(
    (f, i) =>
      `${i + 1}. [${C.severity[f.severity]}] ${f.title}（${location(f)}）\n   ${f.description}${
        f.suggestion === undefined ? '' : `\n   ${C.suggestion}：${f.suggestion}`
      }`,
  );
  return C.fixRequirement(review.label, items.join('\n'));
}

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

function Verdict({ review }: { review: GitReviewDTO }) {
  const counts = severityCounts(review);
  const serious = counts.blocker + counts.major > 0;
  const categories = [...new Set(review.findings.map((f) => f.category))];
  return (
    <div className={`card ${styles.verdict}`} data-testid="git-review-verdict">
      <div className="row">
        <span className={`badge ${serious ? 'st-warn' : review.findings.length > 0 ? 'st-idle' : 'st-ok'}`}>
          <Icon name={serious ? 'alert' : 'check'} size="sm" />
          {serious ? C.verdictIssues : review.findings.length > 0 ? C.verdictMinor : C.verdictClean}
        </span>
        {review.model !== null && <span className={styles.reviewMeta}>{review.model}</span>}
      </div>
      {review.summary !== null && (
        <div className={styles.lead}>
          <Markdown source={review.summary} />
        </div>
      )}
      <div className={styles.sevRow}>
        {SEVERITIES.map((s) => (
          <div key={s} className={styles.sev}>
            <b>{counts[s]}</b>
            <span>
              <i className={styles.sevDot} data-severity={s} />
              {C.severity[s]}
            </span>
          </div>
        ))}
      </div>
      {categories.length > 0 && (
        <div className={styles.cats}>
          {categories.map((cat) => (
            <span key={cat} className={styles.category}>
              {C.category[cat]} {review.findings.filter((f) => f.category === cat).length}
            </span>
          ))}
        </div>
      )}
      <div className={styles.reviewMeta}>
        <Icon name="info" size="sm" />
        <span className="mono">{C.scope(review.from, review.to)}</span>· {C.scopeFiles(review.files.length)}
        {review.focus !== null && <span>· {C.focusIs(review.focus)}</span>}
      </div>
    </div>
  );
}

function Finding({
  finding,
  chosen,
  onChoose,
  onLocate,
}: {
  finding: GitFindingDTO;
  chosen: boolean;
  onChoose: (chosen: boolean) => void;
  onLocate: () => void;
}) {
  return (
    <div className={`card ${styles.finding}`} data-testid="git-finding">
      <input type="checkbox" aria-label={finding.title} checked={chosen} onChange={(e) => onChoose(e.target.checked)} />
      <div className={styles.findingTitle}>
        <span className={styles.severity} data-severity={finding.severity}>
          {C.severity[finding.severity]}
        </span>
        <span className={styles.category}>{C.category[finding.category]}</span>
        <b>
          <Markdown inline source={finding.title} />
        </b>
      </div>
      <div className={styles.findingBody}>
        <button type="button" className={styles.location} onClick={onLocate}>
          <Icon name="file" size="sm" />
          {location(finding)}
        </button>
        <Markdown source={finding.description} />
        {finding.suggestion !== undefined && (
          <details className={styles.suggestion} open={finding.severity !== FindingSeverity.Minor}>
            <summary>{C.suggestion}</summary>
            <Markdown source={finding.suggestion} />
          </details>
        )}
      </div>
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
  onLocate,
}: {
  projectId: string;
  target: GitReviewTargetInput;
  /** Reviews of this diff, newest first. */
  reviews: readonly GitReviewDTO[];
  onLocate: (finding: GitFindingDTO) => void;
}) {
  const navigate = useNavigate();
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  // The user's choices; findings they did not touch are chosen when blocker or major (27 §4.5).
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(new Map());
  const stop = useStopReview(projectId);
  const review = reviews.find((r) => r.id === pickedId) ?? reviews[0];
  // The assistant is told which review the user is looking at (15 §2), not only which view.
  const setShownGitReview = useUiStore((s) => s.setShownGitReview);
  const shownId = review?.id;
  useEffect(() => {
    if (shownId === undefined) return;
    setShownGitReview(shownId);
    return () => setShownGitReview(null);
  }, [shownId, setShownGitReview]);
  if (review === undefined)
    return <StartReview projectId={projectId} target={target} again={false} onStarted={setPickedId} />;
  const index = reviews.length - reviews.indexOf(review);
  const findings = [...review.findings].sort(bySeverity);
  const keyOf = (f: GitFindingDTO) => `${review.id}:${f.path}:${f.line ?? ''}:${f.title}`;
  const isChosen = (f: GitFindingDTO) => choices.get(keyOf(f)) ?? f.severity !== FindingSeverity.Minor;
  const chosen = findings.filter(isChosen);
  const choose = (f: GitFindingDTO, on: boolean) => setChoices(new Map(choices).set(keyOf(f), on));
  const running = isActiveReview(review);
  return (
    <div className={styles.review} data-testid="git-review">
      <div className={styles.reviewTop}>
        {reviews.length > 1 ? (
          <select
            className="select fit"
            aria-label={C.reviewStart}
            value={review.id}
            onChange={(e) => setPickedId(e.target.value)}
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
        <>
          <Verdict review={review} />
          {findings.length > 0 && (
            <>
              <div className={styles.findingsHead}>
                <b>{C.findings}</b>
                <span className="hint">{C.issues(findings.length)}</span>
              </div>
              {findings.map((f) => (
                <Finding
                  key={keyOf(f)}
                  finding={f}
                  chosen={isChosen(f)}
                  onChoose={(on) => choose(f, on)}
                  onLocate={() => onLocate(f)}
                />
              ))}
              <div className={styles.fixBar}>
                <b>{C.selectedFindings(chosen.length)}</b>
                <span className="hint grow">
                  {review.target === GitReviewTarget.Worktree ? C.fixNeedsCommit : C.fixHint}
                </span>
                <Button
                  variant="primary"
                  icon="sparkle"
                  disabled={chosen.length === 0 || review.target === GitReviewTarget.Worktree}
                  onClick={() =>
                    void navigate({
                      to: ROUTES.home,
                      search: { projectId, workflow: 'bugfix', requirement: fixRequirement(review, chosen) },
                    })
                  }
                >
                  {C.fixFromReview}
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {!running && <StartReview projectId={projectId} target={target} again onStarted={setPickedId} />}
    </div>
  );
}
