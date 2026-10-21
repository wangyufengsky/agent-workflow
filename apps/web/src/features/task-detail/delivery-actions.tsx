import {
  ChangeRequestReason,
  DeliveryStatus,
  DeliveryStrategy,
  LOCAL_MERGE_STRATEGIES,
  type LocalMergeStrategy,
  localMergeStrategySchema,
  type TaskDetailDTO,
  UiMode,
  WorkflowDeliverable,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DELIVERY_COPY as C } from '../../copy/delivery.ts';
import { TASK_COPY } from '../../copy/tasks.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { useCancelTask, useDeliver, useRequestChanges } from '../tasks/tasks.queries.ts';
import styles from './task-page.module.css';

type Open = 'options' | 'pr' | 'revise' | 'manual' | 'discard' | undefined;

/** The merge strategy and target the pro-mode options pick; simple mode merges with the default into the base branch. */
function MergeOptions({
  task,
  onMerge,
  pending,
}: {
  task: TaskDetailDTO;
  onMerge: (strategy: LocalMergeStrategy, target: string) => void;
  pending: boolean;
}) {
  const [strategy, setStrategy] = useState<LocalMergeStrategy>(useSettings()['delivery.defaultStrategy']);
  const [target, setTarget] = useState(task.git.baseBranch);
  return (
    <div className="col">
      <div className="field">
        <label className="label" htmlFor="merge-strategy">
          {C.strategy}
        </label>
        <select
          id="merge-strategy"
          className="input"
          value={strategy}
          onChange={(e) => setStrategy(localMergeStrategySchema.parse(e.target.value))}
        >
          {LOCAL_MERGE_STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {C.strategies[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="merge-target">
          {C.targetBranch}
        </label>
        <input id="merge-target" className="input mono" value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <Button
        variant="primary"
        icon="git"
        pending={pending}
        disabled={target.trim() === ''}
        onClick={() => onMerge(strategy, target.trim())}
      >
        {C.mergeNow}
      </Button>
    </div>
  );
}

function PullRequestForm({
  task,
  onCreate,
  pending,
}: {
  task: TaskDetailDTO;
  onCreate: (pr: { title: string; body: string }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.result?.summary ?? '');
  return (
    <div className="col">
      <div className="field">
        <label className="label" htmlFor="pr-title">
          {C.prTitleField}
        </label>
        <input id="pr-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="pr-body">
          {C.prBody}
        </label>
        <textarea id="pr-body" className="textarea" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <Button
        variant="primary"
        pending={pending}
        disabled={title.trim() === ''}
        onClick={() => onCreate({ title: title.trim(), body })}
      >
        {C.prCreate}
      </Button>
    </div>
  );
}

/** What the user can do with a task waiting for review (14 §3.5): merge, open a PR, ask for changes, discard. */
export function DeliveryActions({ task }: { task: TaskDetailDTO }) {
  const settings = useSettings();
  const pro = settings['ui.mode'] === UiMode.Pro;
  const project = useQuery(projectQuery(task.project.id));
  const deliver = useDeliver();
  const changes = useRequestChanges();
  const cancel = useCancelTask();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Open>(undefined);
  const close = () => setOpen(undefined);
  const delivery = task.lastDelivery;
  const conflict = delivery?.status === DeliveryStatus.Conflict ? delivery : null;
  const canPr = project.data?.hosting?.hasToken === true;
  const { pullRequest } = task;
  const report = task.workflow.deliverable === WorkflowDeliverable.Report;

  const merge = (strategy: LocalMergeStrategy, targetBranch: string) =>
    deliver.mutate({ id: task.id, strategy, targetBranch }, { onSuccess: close });

  if (report) {
    return (
      <div className={styles.actions}>
        <Button
          variant="primary"
          pending={deliver.isPending}
          onClick={() => deliver.mutate({ id: task.id, strategy: DeliveryStrategy.ReportOnly })}
        >
          {C.complete}
        </Button>
        <Button
          onClick={() =>
            void navigate({
              to: ROUTES.home,
              search: {
                projectId: task.project.id,
                workflow: 'bugfix',
                requirement: C.fixRequirement(task.result?.summary ?? ''),
              },
            })
          }
        >
          {C.fixFromReport}
        </Button>
        {deliver.isError && <ErrorState error={deliver.error} />}
      </div>
    );
  }

  return (
    <div className="col">
      {conflict !== null && (
        <div className="banner warn" role="status" data-testid="delivery-conflict">
          <Icon name="alert" />
          <div className="grow col">
            <strong>{C.conflictTitle(conflict.targetBranch)}</strong>
            <span>{C.conflictBody}</span>
            <ul className={styles.files}>
              {(conflict.conflictFiles ?? []).map((f) => (
                <li key={f} className="mono">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {delivery?.status === DeliveryStatus.Failed && delivery.error !== null && (
        <div className="col">
          <span className="hint">{C.failedTitle}</span>
          <ErrorState error={delivery.error} />
        </div>
      )}
      <div className={styles.actions}>
        {conflict !== null ? (
          <>
            <Button
              variant="primary"
              icon="sparkle"
              pending={changes.isPending}
              onClick={() =>
                changes.mutate(
                  { id: task.id, reason: ChangeRequestReason.Conflict },
                  { onSuccess: () => toast(C.resolvingStarted) },
                )
              }
            >
              {C.resolveWithAi}
            </Button>
            <Button onClick={() => setOpen('manual')}>{C.resolveMyself}</Button>
          </>
        ) : pullRequest !== null ? (
          // Delivered as a pull request: the platform merges it, revisions go to the same one (21 §5).
          <Button
            variant="primary"
            icon="git"
            pending={deliver.isPending && open === undefined}
            onClick={() => deliver.mutate({ id: task.id, strategy: DeliveryStrategy.PullRequest })}
          >
            {C.pushToPr}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon="git"
              pending={deliver.isPending && open === undefined}
              onClick={() => merge(settings['delivery.defaultStrategy'], task.git.baseBranch)}
            >
              {C.merge(task.git.baseBranch)}
            </Button>
            {pro && (
              <Button variant="ghost" size="sm" onClick={() => setOpen('options')}>
                {C.mergeOptions}
              </Button>
            )}
          </>
        )}
        {pullRequest === null && (
          <span title={canPr ? undefined : C.prNeedsRemote}>
            <Button disabled={!canPr} onClick={() => setOpen('pr')}>
              {C.createPr}
            </Button>
          </span>
        )}
        <Button onClick={() => setOpen('revise')}>{C.revise}</Button>
        <Button variant="ghost" onClick={() => setOpen('discard')}>
          {C.discard}
        </Button>
      </div>
      {pullRequest !== null && conflict === null && (
        <p className="hint">
          {C.pushToPrHint} <ExternalLink href={pullRequest.url}>{C.openPr}</ExternalLink>
        </p>
      )}
      {pullRequest === null && !canPr && project.data !== undefined && (
        <p className="hint">
          {C.prNeedsRemote}{' '}
          <Link to={ROUTES.project} params={{ projectId: task.project.id }} className="link">
            {C.prBindRemote}
          </Link>
        </p>
      )}
      {(deliver.isError || changes.isError) && open === undefined && (
        <ErrorState error={deliver.isError ? deliver.error : changes.error} />
      )}

      <Dialog open={open === 'options'} onOpenChange={(o) => !o && close()} title={C.mergeOptionsTitle}>
        <MergeOptions task={task} onMerge={merge} pending={deliver.isPending} />
        {deliver.isError && <ErrorState error={deliver.error} />}
      </Dialog>
      <Dialog open={open === 'pr'} onOpenChange={(o) => !o && close()} title={C.prTitle}>
        <PullRequestForm
          task={task}
          pending={deliver.isPending}
          onCreate={(pr) =>
            deliver.mutate({ id: task.id, strategy: DeliveryStrategy.PullRequest, pr }, { onSuccess: close })
          }
        />
        {deliver.isError && <ErrorState error={deliver.error} />}
      </Dialog>
      <ReviseDialog task={task} open={open === 'revise'} onClose={close} />
      <Dialog open={open === 'manual'} onOpenChange={(o) => !o && close()} title={C.resolveMyselfTitle}>
        <p>{C.resolveMyselfBody}</p>
        <pre className={styles.output}>
          {`cd ${task.git.worktreePath ?? ''}\ngit merge ${conflict?.targetBranch ?? task.git.baseBranch}\n# 解决冲突后\ngit add -A\ngit commit`}
        </pre>
        {pro && (
          <Link to={ROUTES.gitProject} params={{ projectId: task.project.id }}>
            {C.resolveMyselfGit}
          </Link>
        )}
      </Dialog>
      <Dialog
        open={open === 'discard'}
        onOpenChange={(o) => !o && close()}
        title={TASK_COPY.cancelTitle}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {COMMON_COPY.cancel}
            </Button>
            <Button
              variant="danger"
              pending={cancel.isPending}
              onClick={() => cancel.mutate(task.id, { onSuccess: () => toast(TASK_COPY.cancelled) })}
            >
              {C.discard}
            </Button>
          </>
        }
      >
        <p>{TASK_COPY.cancelBody}</p>
        {cancel.isError && <ErrorState error={cancel.error} />}
      </Dialog>
    </div>
  );
}

function ReviseDialog({ task, open, onClose }: { task: TaskDetailDTO; open: boolean; onClose: () => void }) {
  const [feedback, setFeedback] = useState('');
  const changes = useRequestChanges();
  const send = () =>
    changes.mutate(
      { id: task.id, reason: ChangeRequestReason.User, feedback: feedback.trim() },
      {
        onSuccess: () => {
          toast(C.revised);
          onClose();
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={C.reviseTitle}
      footer={
        <Button variant="primary" pending={changes.isPending} disabled={feedback.trim() === ''} onClick={send}>
          {C.reviseSend}
        </Button>
      }
    >
      <textarea
        className="textarea"
        rows={5}
        aria-label={C.revisePlaceholder}
        placeholder={C.revisePlaceholder}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      {changes.isError && <ErrorState error={changes.error} />}
    </Dialog>
  );
}
