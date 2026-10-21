import {
  type ScheduleDetailDTO,
  type ScheduleRunDTO,
  ScheduleRunOutcome,
  ScheduleRunTrigger,
  ScheduleStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import {
  SCHEDULES_COPY as C,
  frequencyText,
  SCHEDULE_OUTCOME_LABEL,
  SCHEDULE_TRIGGER_LABEL,
} from '../../copy/schedules.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { NextRun, ScheduleBadge, workflowName } from './schedule-status.tsx';
import styles from './schedules.module.css';
import {
  scheduleQuery,
  useDeleteSchedule,
  usePauseSchedule,
  useResumeSchedule,
  useRunSchedule,
} from './schedules.queries.ts';

const route = getRouteApi(ROUTE_IDS.schedule);

/** What a run did, in words, with its task when it made one. */
function RunOutcome({ run }: { run: ScheduleRunDTO }) {
  if (run.task !== null) {
    return (
      <span className="row">
        <Link to={ROUTES.task} params={{ taskId: run.task.id }}>
          <span className="mono">{run.task.key}</span> · {run.task.title}
        </Link>
        <TaskBadge group={run.task.displayGroup} />
      </span>
    );
  }
  if (run.outcome === ScheduleRunOutcome.Failed && run.error !== null) {
    return <span className="error-text">{C.failedBecause(ERROR_COPY[run.error.code])}</span>;
  }
  return <span className="hint">{SCHEDULE_OUTCOME_LABEL[run.outcome]}</span>;
}

function DeleteSchedule({ schedule }: { schedule: ScheduleDetailDTO }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const remove = useDeleteSchedule();
  return (
    <>
      <Button variant="ghost" icon="trash" onClick={() => setOpen(true)}>
        {C.delete}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={C.deleteTitle}
        description={C.deleteBody}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{COMMON_COPY.cancel}</Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() => remove.mutate(schedule.id, { onSuccess: () => void navigate({ to: ROUTES.schedules }) })}
            >
              {C.delete}
            </Button>
          </>
        }
      >
        {remove.isError && <ErrorState error={remove.error} />}
      </Dialog>
    </>
  );
}

/** A schedule (22 §7): how often and when next, its actions, the task in progress and the run history. */
export function SchedulePage() {
  const { scheduleId } = route.useParams();
  const schedule = useQuery(scheduleQuery(scheduleId));
  const run = useRunSchedule();
  const pause = usePauseSchedule();
  const resume = useResumeSchedule();
  if (schedule.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (schedule.isError) {
    return (
      <div className="page narrow">
        <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />
      </div>
    );
  }
  const s = schedule.data;
  const paused = s.status === ScheduleStatus.Paused;
  const pausedByFailure = paused && s.lastRun?.outcome === ScheduleRunOutcome.Failed;
  const mutation = [run, pause, resume].find((m) => m.isError);
  return (
    <div className="page" data-testid="schedule-page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{s.title}</h1>
          <p className="lede">{C.meta(workflowName(s), s.project.name)}</p>
        </div>
        <ScheduleBadge schedule={s} />
      </div>
      <section className="card pad col">
        <span className="section-title">{frequencyText(s.frequency)}</span>
        <NextRun schedule={s} />
        {pausedByFailure && <p className="error-text">{C.pausedByFailure}</p>}
        <div className={styles.preview}>{s.requirement}</div>
        <div className="row wrap">
          <Button
            variant="primary"
            icon="play"
            pending={run.isPending}
            disabled={s.activeTask !== null}
            onClick={() => run.mutate(s.id)}
          >
            {C.runNow}
          </Button>
          {paused ? (
            <Button pending={resume.isPending} onClick={() => resume.mutate(s.id)}>
              {C.resume}
            </Button>
          ) : (
            <Button pending={pause.isPending} onClick={() => pause.mutate(s.id)}>
              {C.pause}
            </Button>
          )}
          <Link to={ROUTES.scheduleEdit} params={{ scheduleId: s.id }} className="btn">
            {C.edit}
          </Link>
          <span className="grow" />
          <DeleteSchedule schedule={s} />
        </div>
        {s.activeTask !== null && <span className="hint">{C.busy}</span>}
        {mutation?.error && <ErrorState error={mutation.error} />}
      </section>
      {s.activeTask !== null && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">{C.current}</h2>
          </div>
          <Link to={ROUTES.task} params={{ taskId: s.activeTask.id }} className="card pad row">
            <span className="grow ellipsis">
              <span className="mono">{s.activeTask.key}</span> · {s.activeTask.title}
            </span>
            <TaskBadge group={s.activeTask.displayGroup} />
          </Link>
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{C.runs}</h2>
        </div>
        {s.runs.length === 0 ? (
          <p className="hint">{C.noRuns}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{C.columns.when}</th>
                <th>{C.columns.trigger}</th>
                <th>{C.columns.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {s.runs.map((r) => (
                <tr key={r.id} data-testid="schedule-run">
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>
                    {SCHEDULE_TRIGGER_LABEL[r.trigger]}
                    {r.trigger === ScheduleRunTrigger.CatchUp && (
                      <span className={styles.note}>{C.catchUp(formatDateTime(r.dueAt), r.missed)}</span>
                    )}
                  </td>
                  <td>
                    <RunOutcome run={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
