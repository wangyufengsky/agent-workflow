import { type ScheduleDTO, ScheduleStatus, STATUS_TONE } from '@aw/shared';
import { StatusBadge } from '../../components/status-badge.tsx';
import { formatDateTime } from '../../copy/common.ts';
import { SCHEDULES_COPY as C, SCHEDULE_STATUS_LABEL } from '../../copy/schedules.ts';

export function ScheduleBadge({ schedule }: { schedule: ScheduleDTO }) {
  return <StatusBadge tone={STATUS_TONE.schedule[schedule.status]} label={SCHEDULE_STATUS_LABEL[schedule.status]} />;
}

/** 「下次运行：…」, or that it is paused. */
export function NextRun({ schedule }: { schedule: ScheduleDTO }) {
  return (
    <span className="hint" data-testid="schedule-next">
      {schedule.status === ScheduleStatus.Paused || schedule.nextRunAt === null
        ? C.paused
        : C.nextRun(formatDateTime(schedule.nextRunAt))}
    </span>
  );
}

export const workflowName = (schedule: ScheduleDTO) =>
  schedule.workflow.name ?? C.workflowDeleted(schedule.workflow.key);
