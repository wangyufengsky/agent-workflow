import {
  DeliveryStatus,
  DeliveryStrategy,
  type TaskDetailDTO,
  TaskStatus,
  WorkflowDeliverable,
  WorktreeStatus,
} from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffDialog } from '../../components/diff/diff-dialog.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { DELIVERY_COPY as D } from '../../copy/delivery.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { skippedCommands } from '../tasks/skipped-checks.ts';
import { taskDiffFileQuery, taskDiffQuery } from '../tasks/tasks.queries.ts';
import { DeliveryActions } from './delivery-actions.tsx';
import { ReviewComments } from './review-comments.tsx';
import styles from './task-page.module.css';

/** How the task was delivered, once it is merging or done. */
function DeliveryOutcome({ task }: { task: TaskDetailDTO }) {
  const delivery = task.lastDelivery;
  if (task.status === TaskStatus.Merging) {
    return (
      <p className="row hint">
        <span className="spin" aria-hidden="true" />
        {D.merging}
      </p>
    );
  }
  if (task.status !== TaskStatus.Completed || delivery?.status !== DeliveryStatus.Succeeded) return null;
  if (delivery.strategy === DeliveryStrategy.PullRequest && delivery.prUrl !== null) {
    const url = delivery.prUrl;
    return (
      <p className="row" data-testid="delivery-outcome">
        <Icon name="git" />
        {D.prOpened}
        <ExternalLink href={url}>{D.openPr}</ExternalLink>
      </p>
    );
  }
  return (
    <p className="row" data-testid="delivery-outcome">
      <Icon name="check" />
      {delivery.commitSha === null ? D.reportDone : D.merged(delivery.targetBranch, delivery.commitSha)}
    </p>
  );
}

/** Result card (14 §3.5): what was done, the changes, and the delivery decisions while in review. */
export function ResultCard({ task }: { task: TaskDetailDTO }) {
  // The large diff opens on the file clicked, or the first one (D114).
  const [viewing, setViewing] = useState<{ path: string | undefined } | null>(null);
  const { result } = task;
  if (result === null) return <p className="hint">{C.resultPending}</p>;
  const report = task.workflow.deliverable === WorkflowDeliverable.Report;
  const failedChecks = result.checks.filter((c) => !c.passed).length;
  const skipped = skippedCommands(result);
  // One skipped check per step that had the command; the commands are listed once each.
  const skippedCount = result.checks.filter((c) => c.skipped).length;
  const checks =
    result.checks.length === 0
      ? C.noChecks
      : failedChecks > 0
        ? C.checksFailed(failedChecks)
        : skippedCount > 0
          ? C.checksSkipped(skippedCount, skipped)
          : C.checksPassed;
  // The diff is read from the worktree, which goes away once the task is delivered or cancelled.
  const browsable = task.git.worktreeStatus === WorktreeStatus.Ready;
  return (
    <Panel solid>
      <div className={styles.result} data-testid="result-card">
        <div className="row">
          <p className={`${styles.headline} grow`}>
            <Icon name="check" />
            {C.resultHeadline(result.nodeSummaries.length, result.filesChanged, result.insertions, result.deletions)} ·{' '}
            <Markdown inline source={checks} />
          </p>
          {/* 23 §2.5: the result as a PPT for the team. */}
          <Link to={ROUTES.pptNew} search={{ taskId: task.id }} className="btn ghost sm">
            <Icon name="slides" size="sm" />
            {PPT_COPY.makeDeck}
          </Link>
        </div>
        <DeliveryOutcome task={task} />
        <section className={styles.block}>
          <h3 className="sec-t">{report ? C.report : C.summary}</h3>
          {report ? (
            <Markdown source={result.summary} />
          ) : (
            <ol className={styles.stepSummaries}>
              {result.nodeSummaries.map((n) => (
                <li key={n.key}>
                  <span className={styles.stepTitle}>{n.title}</span>
                  <Markdown source={n.summary} />
                </li>
              ))}
            </ol>
          )}
        </section>
        {result.assumptions.length > 0 && (
          <section className={styles.block}>
            <h3 className="sec-t">{C.assumptions}</h3>
            <ul className={styles.bullets}>
              {result.assumptions.map((a) => (
                <li key={a}>
                  <Markdown inline source={a} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {result.files.length > 0 && (
          <section className={styles.block}>
            <div className={styles.blockHead}>
              <h3 className="sec-t grow">{C.changedFiles}</h3>
              {browsable && (
                <Button size="sm" variant="ghost" onClick={() => setViewing({ path: undefined })}>
                  {D.viewChanges}
                </Button>
              )}
            </div>
            <ul className={styles.files}>
              {result.files.map((f) => (
                <li key={f.path} className={styles.file}>
                  {browsable ? (
                    <button
                      type="button"
                      className={`mono grow ellipsis ${styles.fileLink}`}
                      onClick={() => setViewing({ path: f.path })}
                    >
                      {f.path}
                    </button>
                  ) : (
                    <span className="mono grow ellipsis">{f.path}</span>
                  )}
                  <span className={styles.add}>+{f.additions ?? 0}</span>
                  <span className={styles.del}>−{f.deletions ?? 0}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {task.status === TaskStatus.Completed && task.pullRequest !== null && <ReviewComments task={task} />}
        {task.status === TaskStatus.Review && <DeliveryActions task={task} />}
      </div>
      {browsable && (
        <DiffDialog
          open={viewing !== null}
          onOpenChange={(open) => !open && setViewing(null)}
          title={D.changesTitle}
          query={taskDiffQuery(task.id)}
          fileQuery={taskDiffFileQuery(task.id)}
          path={viewing?.path}
        />
      )}
    </Panel>
  );
}
