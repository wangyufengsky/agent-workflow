import { AttemptKind, type TaskDetailDTO, TaskStatus, TranscriptEntryKind } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/icon.tsx';
import { Panel } from '../../components/panel.tsx';
import { toolActionLabel } from '../../copy/attempts.ts';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { relativeTo, toolAction } from '../attempts/process-lines.ts';
import styles from './task-page.module.css';

/** The planning session's latest tool call, as one line. */
function LastAction({ attemptId }: { attemptId: string }) {
  const attempt = useQuery(attemptQuery(attemptId));
  const { entries } = useTranscript(attemptTranscript(attemptId));
  const call = entries.findLast((e) => e.kind === TranscriptEntryKind.ToolCall);
  if (call?.kind !== TranscriptEntryKind.ToolCall || attempt.data === undefined) return null;
  const action = toolAction(call.data.tool, call.data.input, relativeTo(attempt.data.directory));
  return (
    <p className={styles.activity}>
      {C.lastAction}：<span className="mono">{toolActionLabel(action)}</span>
    </p>
  );
}

/** Preparing / planning (14 §3.3): the stages, and what the planning session is doing. */
export function PlanningProgress({ task }: { task: TaskDetailDTO }) {
  const planning = task.status === TaskStatus.Planning;
  const attempt = task.activeAttempts.find((a) => a.kind === AttemptKind.Plan);
  const stages = [
    { label: C.stagePreparing, state: planning ? 'done' : 'active' },
    { label: C.stagePlanning, state: planning ? 'active' : 'pending' },
  ];
  return (
    <Panel>
      <ol className={styles.stages}>
        {stages.map((stage) => (
          <li key={stage.label} className={styles.stage} data-state={stage.state}>
            {stage.state === 'done' ? (
              <Icon name="check" />
            ) : stage.state === 'active' ? (
              <span className="spin" aria-hidden="true" />
            ) : (
              <Icon name="info" />
            )}
            {stage.label}
          </li>
        ))}
      </ol>
      {attempt !== undefined && attempt.progress !== null && (
        <p className={styles.activity}>
          {C.planningNow}：{attempt.progress}
        </p>
      )}
      {attempt !== undefined && <LastAction attemptId={attempt.id} />}
    </Panel>
  );
}
