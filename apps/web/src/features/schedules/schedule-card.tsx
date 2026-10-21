import type { ScheduleDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { SCHEDULES_COPY as C, frequencyText, SCHEDULE_OUTCOME_LABEL } from '../../copy/schedules.ts';
import { NextRun, ScheduleBadge, workflowName } from './schedule-status.tsx';

/** A schedule in a list: title, how often, when next, and how the latest run went. */
export function ScheduleCard({ schedule }: { schedule: ScheduleDTO }) {
  return (
    <Link
      to={ROUTES.schedule}
      params={{ scheduleId: schedule.id }}
      className="card pad col"
      data-testid="schedule-card"
    >
      <div className="row">
        <span className="section-title ellipsis grow">{schedule.title}</span>
        <ScheduleBadge schedule={schedule} />
      </div>
      <span className="hint ellipsis">{C.meta(workflowName(schedule), schedule.project.name)}</span>
      <span>{frequencyText(schedule.frequency)}</span>
      <NextRun schedule={schedule} />
      {schedule.lastRun !== null && (
        <span className="hint ellipsis">
          {C.lastRun}：{SCHEDULE_OUTCOME_LABEL[schedule.lastRun.outcome]}
        </span>
      )}
    </Link>
  );
}
