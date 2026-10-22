import {
  AttemptKind,
  BASH_PERMISSION,
  FailureAction,
  type InboxItemDTO,
  type InboxItemOf,
  InboxKind,
  PermissionDecision,
  projectBashPatterns,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { ERROR_COPY } from '../../copy/errors.ts';
import { SCHEDULES_COPY } from '../../copy/schedules.ts';
import { INBOX_COPY as C } from '../../copy/tasks.ts';
import { attemptQuery } from '../attempts/attempt.queries.ts';
import { schedulesQuery } from '../schedules/schedules.queries.ts';
import { failureText } from '../tasks/failure-text.ts';
import { taskQuery, tasksQuery } from '../tasks/tasks.queries.ts';
import { type InboxResponse, useDismissInbox, useResolveInbox } from './inbox.queries.ts';
import styles from './inbox-card.module.css';

type CardProps<K extends InboxItemDTO['kind']> = {
  item: InboxItemOf<K>;
  resolve: (response: InboxResponse) => void;
  pending: boolean;
};

function QuestionCard({ item, resolve, pending }: CardProps<typeof InboxKind.Question>) {
  const [answer, setAnswer] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (answer.trim() !== '') resolve({ answer: answer.trim() });
  };
  return (
    <>
      <Markdown source={item.payload.question} />
      {item.payload.blocking && <span className="hint">{C.blocking}</span>}
      {item.payload.defaultAssumption !== undefined && (
        <span className="hint">{C.defaultAssumption(item.payload.defaultAssumption)}</span>
      )}
      {item.payload.options !== undefined && (
        <div className={styles.options}>
          {item.payload.options.map((option) => (
            <Button key={option} size="sm" disabled={pending} onClick={() => resolve({ answer: option })}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <form className="row" onSubmit={submit}>
        <input
          className="input grow"
          aria-label={C.answerPlaceholder}
          placeholder={C.answerPlaceholder}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <Button type="submit" variant="primary" size="sm" pending={pending} disabled={answer.trim() === ''}>
          {C.submit}
        </Button>
      </form>
    </>
  );
}

function PermissionCard({ item, resolve, pending }: CardProps<typeof InboxKind.Permission>) {
  // What「总是允许」remembers for the project (D101); other permissions stay with the session.
  const remembered = item.payload.permission === BASH_PERMISSION ? projectBashPatterns(item.payload.patterns) : [];
  return (
    <>
      <span className="sub">
        {C.wantsTo}（{item.payload.permission}）
      </span>
      <code className={styles.command}>{item.payload.patterns.join('\n')}</code>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() => resolve({ decision: PermissionDecision.Once })}
        >
          {C.allowOnce}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => resolve({ decision: PermissionDecision.Always })}>
          {C.allowAlways}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => resolve({ decision: PermissionDecision.Reject })}
        >
          {C.reject}
        </Button>
      </div>
      {remembered.length > 0 && <p className="hint">{C.alwaysRemembers(remembered.join('、'))}</p>}
    </>
  );
}

function AcceptanceCard({ item, resolve, pending }: CardProps<typeof InboxKind.Acceptance>) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');
  return (
    <>
      <p className={styles.title}>{item.title}</p>
      {rejecting ? (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault();
            resolve({ accepted: false, feedback: feedback.trim() });
          }}
        >
          <textarea
            className="textarea"
            rows={3}
            aria-label={C.rejectPlaceholder}
            placeholder={C.rejectPlaceholder}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className={styles.actions}>
            <Button type="submit" variant="danger" size="sm" pending={pending} disabled={feedback.trim() === ''}>
              {C.rejectStep}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" size="sm" pending={pending} onClick={() => resolve({ accepted: true })}>
            {C.accept}
          </Button>
          <Button size="sm" onClick={() => setRejecting(true)}>
            {C.rejectStep}
          </Button>
        </div>
      )}
    </>
  );
}

function FailureCard({ item, resolve, pending }: CardProps<typeof InboxKind.Failure>) {
  const { error } = item.payload;
  return (
    <>
      <p className={styles.title}>{failureText(item.payload.phase, error)}</p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={pending} onClick={() => resolve({ action: FailureAction.Retry })}>
          {C.retry}
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={() => resolve({ action: FailureAction.Cancel })}>
          {C.cancelTask}
        </Button>
      </div>
    </>
  );
}

function TaskLink({ item, label }: { item: InboxItemDTO; label: string }) {
  if (item.taskId === null) return null;
  return (
    <Link to={ROUTES.task} params={{ taskId: item.taskId }} className="btn primary sm">
      {label}
    </Link>
  );
}

/** Kinds whose card text does not name the step it came from. */
const NAMES_NO_STEP = new Set<InboxKind>([InboxKind.Question, InboxKind.Permission]);

/**
 * Where an item comes from (14 §3.6): the schedule that started its task (22 §6), its task (unless the list already
 * groups by it) and, for questions and permissions, its step; other items without a task come from a knowledge
 * question or a PPT, told by its attempt. The task comes from the one task list every card shares; only questions
 * and permissions, which belong to running steps, read their task's steps. A schedule has at most one task that has
 * not ended, its `activeTask`.
 */
function useSource(item: InboxItemDTO, showTask: boolean): string | undefined {
  const needsStep = item.taskId !== null && item.nodeId !== null && NAMES_NO_STEP.has(item.kind);
  const tasks = useQuery({ ...tasksQuery(), enabled: showTask && item.taskId !== null }).data;
  const detail = useQuery({ ...taskQuery(item.taskId ?? ''), enabled: needsStep }).data;
  const schedules = useQuery(schedulesQuery()).data;
  const attempt = useQuery({
    ...attemptQuery(item.attemptId ?? ''),
    enabled: item.taskId === null && item.attemptId !== null,
  }).data;
  if (item.kind === InboxKind.ScheduleFailure) return SCHEDULES_COPY.fromSchedule(item.title);
  if (item.taskId === null) {
    if (attempt === undefined) return undefined;
    return attempt.kind === AttemptKind.Research ? C.fromKnowledge : C.fromPpt;
  }
  const parts: string[] = [];
  const schedule = schedules?.find((s) => s.activeTask?.id === item.taskId);
  if (schedule !== undefined) parts.push(SCHEDULES_COPY.fromSchedule(schedule.title));
  const task = tasks?.find((t) => t.id === item.taskId);
  if (showTask && task !== undefined) parts.push(C.inTask(task.key, task.title));
  const step = detail?.nodes.find((n) => n.id === item.nodeId);
  if (step !== undefined) parts.push(C.inStep(step.title));
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** One open item, handled where it is shown (14 §3.6); `showTask` is off where the list is already the task's. */
export function InboxCard({ item, showTask = true }: { item: InboxItemDTO; showTask?: boolean }) {
  const resolve = useResolveInbox();
  const dismiss = useDismissInbox();
  const label = useSource(item, showTask);
  const props = {
    pending: resolve.isPending,
    resolve: (response: InboxResponse) => resolve.mutate({ id: item.id, response }),
  };
  return (
    <article className={styles.card} data-testid={`inbox-${item.kind}`}>
      <header className={styles.head}>
        <span className="chip">{C.kind[item.kind]}</span>
        {label !== undefined && <span className="ellipsis">{label}</span>}
      </header>
      {item.kind === InboxKind.Question && <QuestionCard item={item} {...props} />}
      {item.kind === InboxKind.Permission && <PermissionCard item={item} {...props} />}
      {item.kind === InboxKind.Acceptance && <AcceptanceCard item={item} {...props} />}
      {item.kind === InboxKind.Failure && <FailureCard item={item} {...props} />}
      {item.kind === InboxKind.Plan && (
        <>
          <p className={styles.title}>{C.planBody(item.payload.version)}</p>
          <div className={styles.actions}>
            <TaskLink item={item} label={C.confirmPlan} />
          </div>
        </>
      )}
      {item.kind === InboxKind.Delivery && (
        <>
          <p className={styles.title}>{C.deliveryReady}</p>
          <div className={styles.actions}>
            <TaskLink item={item} label={C.viewResult} />
            <Button size="sm" pending={dismiss.isPending} onClick={() => dismiss.mutate(item.id)}>
              {C.dismiss}
            </Button>
          </div>
        </>
      )}
      {item.kind === InboxKind.ScheduleFailure && (
        <>
          <p className={styles.title}>{SCHEDULES_COPY.failedBecause(ERROR_COPY[item.payload.error.code])}</p>
          <span className="hint">{SCHEDULES_COPY.pausedByFailure}</span>
          <div className={styles.actions}>
            <Link to={ROUTES.schedule} params={{ scheduleId: item.payload.scheduleId }} className="btn primary sm">
              {SCHEDULES_COPY.open}
            </Link>
            <Button size="sm" pending={dismiss.isPending} onClick={() => dismiss.mutate(item.id)}>
              {C.dismiss}
            </Button>
          </div>
        </>
      )}
      {resolve.isError && <ErrorState error={resolve.error} />}
      {dismiss.isError && <ErrorState error={dismiss.error} />}
    </article>
  );
}
