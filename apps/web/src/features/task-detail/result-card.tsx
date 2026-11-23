import {
  AcceptanceCheckKind,
  BrowserCaseOutcome,
  DeliveryStatus,
  DeliveryStrategy,
  ErrorCode,
  type TaskDetailDTO,
  TaskStatus,
  taskCheckEvidenceOp,
  UiMode,
  WorkflowDeliverable,
  WorktreeStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, callOperation } from '../../api/client.ts';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { DiffDialog } from '../../components/diff/diff-dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { Panel } from '../../components/panel.tsx';
import { BROWSER_CASE_COPY } from '../../copy/browser-cases.ts';
import { DELIVERY_COPY as D } from '../../copy/delivery.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { BROWSER_TEST_COPY, TASK_COPY as C } from '../../copy/tasks.ts';
import { BrowserCaseReport } from '../browser-cases/browser-case-report.tsx';
import { attemptFileUrl, previewSessionsQuery, useImage } from '../preview/preview.queries.ts';
import { ResultPages } from '../preview/result-pages.tsx';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { AutoAcceptanceEvidence } from '../tasks/auto-acceptance-evidence.tsx';
import { noAutomaticCheck, skippedChecks } from '../tasks/skipped-checks.ts';
import { taskDiffFileQuery, taskDiffQuery } from '../tasks/tasks.queries.ts';
import { DeliveryActions } from './delivery-actions.tsx';
import { Check } from './node-drawer.tsx';
import { RemoteDeliveryStatus } from './remote-delivery-status.tsx';
import { ReviewComments } from './review-comments.tsx';
import styles from './task-page.module.css';

const taskRoute = getRouteApi(ROUTE_IDS.task);

/** How the task was delivered, once it is merging or done. */
export function DeliveryOutcome({ task }: { task: TaskDetailDTO }) {
  const delivery = task.lastDelivery;
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
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
      {delivery.commitSha === null ? (
        D.reportDone
      ) : pro && delivery.diffBase === null ? (
        <Link
          to={ROUTES.gitProject}
          params={{ projectId: task.project.id }}
          search={{ view: 'commits', ref: delivery.targetBranch, sha: delivery.commitSha }}
        >
          {D.merged(delivery.targetBranch, delivery.commitSha)}
        </Link>
      ) : (
        D.merged(delivery.targetBranch, delivery.commitSha)
      )}
    </p>
  );
}

function TestScreenshot({ attemptId, file }: { attemptId: string; file: string }) {
  const src = useImage(attemptFileUrl(attemptId, file));
  return src === null ? null : (
    <a className="btn sm" href={src} download={file}>
      {file}
    </a>
  );
}

function BrowserTestEvidence({ taskId }: { taskId: string }) {
  const sessions = useQuery(previewSessionsQuery(taskId));
  const attempts = sessions.data?.attempts.filter((attempt) => attempt.screenshots.length > 0) ?? [];
  if (attempts.length === 0) return null;
  return (
    <section className={styles.block}>
      <h3 className="sec-t">{BROWSER_TEST_COPY.screenshots}</h3>
      {attempts.map((attempt) => (
        <div className="row" key={attempt.attemptId}>
          {attempt.screenshots.map((file) => (
            <TestScreenshot key={file} file={file} attemptId={attempt.attemptId} />
          ))}
        </div>
      ))}
    </section>
  );
}

/** Result card (14 §3.5): what was done, the changes, and the delivery decisions while in review. */
export function ResultCard({ task }: { task: TaskDetailDTO }) {
  // The large diff opens on the file clicked, or the first one (D114).
  const [viewing, setViewing] = useState<{ path: string | undefined } | null>(null);
  const { delivery } = taskRoute.useSearch();
  const navigate = taskRoute.useNavigate();
  const { result } = task;
  if (result === null) return <p className="hint">{C.resultPending}</p>;
  const report = task.workflow.deliverable === WorkflowDeliverable.Report;
  const caseReport = result.browserCaseReport;
  const failedChecks = result.checks.filter((c) => !c.passed && !c.skipped).length;
  const skipped = skippedChecks(result);
  // One skipped check per step that had the command; the commands are listed once each.
  const skippedCount = result.checks.filter((c) => c.skipped && !noAutomaticCheck(c)).length;
  const unavailableCount = result.checks.filter(noAutomaticCheck).length;
  const evidenceChecks = result.checks.filter(
    (check) =>
      !check.passed ||
      check.skipped ||
      check.kind === AcceptanceCheckKind.Browser ||
      (check.kind === AcceptanceCheckKind.Command && check.autoSelection !== undefined),
  );
  const checks =
    result.checks.length === 0
      ? C.noChecks
      : failedChecks > 0
        ? C.checksFailed(failedChecks)
        : skippedCount > 0
          ? C.checksSkipped(skippedCount, skipped)
          : unavailableCount > 0
            ? C.autoNoChecks(unavailableCount)
            : C.checksPassed;
  const delivered = task.status === TaskStatus.Completed && task.lastDelivery?.status === DeliveryStatus.Succeeded;
  // Delivered changes use their recorded commit range after the worktree is removed.
  const browsable = task.git.worktreeStatus === WorktreeStatus.Ready || (delivered && !report);
  return (
    <Panel solid>
      <div className={styles.result} data-testid="result-card">
        <div className="row">
          <p className={`${styles.headline} grow`}>
            {caseReport === undefined ? (
              <>
                <Icon name="check" />
                {C.resultHeadline(
                  result.nodeSummaries.length,
                  result.filesChanged,
                  result.insertions,
                  result.deletions,
                )}{' '}
                · <Markdown inline source={checks} />
                {unavailableCount > 0 &&
                  (failedChecks > 0 || skippedCount > 0) &&
                  ` · ${C.autoNoChecks(unavailableCount)}`}
              </>
            ) : (
              <>
                <Icon name={caseReport.outcome === BrowserCaseOutcome.Passed ? 'check' : 'alert'} />
                {BROWSER_CASE_COPY.outcome[caseReport.outcome]}
              </>
            )}
          </p>
          {/* 23 §2.5: the result as a PPT for the team. */}
          <Link to={ROUTES.pptNew} search={{ taskId: task.id }} className="btn ghost sm">
            <Icon name="slides" size="sm" />
            {PPT_COPY.makeDeck}
          </Link>
        </div>
        {caseReport === undefined && (
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
        )}
        {task.browserCase !== undefined && caseReport !== undefined ? (
          <BrowserCaseReport test={task.browserCase} report={caseReport} />
        ) : (
          task.browserTest !== undefined && <BrowserTestEvidence taskId={task.id} />
        )}
        {evidenceChecks.length > 0 && (
          <section className={styles.block}>
            <h3 className="sec-t">{C.checkEvidenceHeading}</h3>
            {evidenceChecks.map((check, index) => (
              <div key={check.evidenceId ?? `${check.nodeKey}-${index}`} data-testid="check-evidence-row">
                <p>
                  {check.nodeTitle}
                  {check.commitSha ? C.checkEvidenceCommit(check.commitSha) : ''}
                </p>
                {check.kind === AcceptanceCheckKind.Command && <AutoAcceptanceEvidence check={check} />}
                {check.evidenceId === undefined ? (
                  !noAutomaticCheck(check) && <p className="hint">{C.checkEvidenceOld}</p>
                ) : (
                  <Evidence taskId={task.id} evidenceId={check.evidenceId} />
                )}
              </div>
            ))}
          </section>
        )}
        <ResultPages task={task} />
        <DeliveryOutcome task={task} />
        {task.status === TaskStatus.Completed && task.lastDelivery?.strategy === DeliveryStrategy.PullRequest && (
          <RemoteDeliveryStatus task={task} />
        )}
        {task.functionalTest === undefined && <RequirementsSection task={task} />}
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
        {task.functionalTest === undefined && task.status === TaskStatus.Review && <DeliveryActions task={task} />}
      </div>
      {browsable && (
        <DiffDialog
          open={(delivered && delivery === true) || viewing !== null}
          onOpenChange={(open) => {
            if (open) return;
            setViewing(null);
            if (delivery === true)
              void navigate({ search: (previous) => ({ ...previous, delivery: undefined }), replace: true });
          }}
          title={D.changesTitle}
          query={taskDiffQuery(task.id)}
          fileQuery={taskDiffFileQuery(task.id)}
          path={viewing?.path}
        />
      )}
    </Panel>
  );
}

function Evidence({ taskId, evidenceId }: { taskId: string; evidenceId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['task-check-evidence', taskId, evidenceId],
    queryFn: () => callOperation(taskCheckEvidenceOp, { id: taskId, evidenceId }),
    enabled: open,
  });
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
        {open ? C.checkEvidenceClose : C.checkEvidenceView}
      </Button>
      {open && query.isPending && <p className="hint">{C.checkEvidenceLoading}</p>}
      {open &&
        query.isError &&
        (query.error instanceof ApiError && query.error.code === ErrorCode.NotFound ? (
          <p className="hint">{C.checkEvidenceUnavailable}</p>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ))}
      {open && query.isSuccess && <Check taskId={taskId} check={query.data} />}
    </div>
  );
}
