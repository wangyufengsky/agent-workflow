import { FailureAction, type InboxItemDTO, type InboxItemOf, InboxKind, PermissionDecision } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ERROR_COPY } from '../../copy/errors.ts';
import { INBOX_COPY as C, TASK_COPY } from '../../copy/tasks.ts';
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
      <p className={styles.title}>{item.payload.question}</p>
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
      <p className={styles.title}>
        {TASK_COPY.failedPhase[item.payload.phase]}：{ERROR_COPY[error.code]}
      </p>
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

/** One open item, handled where it is shown (14 §3.6). */
export function InboxCard({ item, taskLabel }: { item: InboxItemDTO; taskLabel?: string | undefined }) {
  const resolve = useResolveInbox();
  const dismiss = useDismissInbox();
  const props = {
    pending: resolve.isPending,
    resolve: (response: InboxResponse) => resolve.mutate({ id: item.id, response }),
  };
  return (
    <article className={styles.card} data-testid={`inbox-${item.kind}`}>
      <header className={styles.head}>
        <span className="chip">{C.kind[item.kind]}</span>
        {taskLabel !== undefined && <span className="ellipsis">{taskLabel}</span>}
      </header>
      {item.kind === InboxKind.Question && <QuestionCard item={item} {...props} />}
      {item.kind === InboxKind.Permission && <PermissionCard item={item} {...props} />}
      {item.kind === InboxKind.Acceptance && <AcceptanceCard item={item} {...props} />}
      {item.kind === InboxKind.Failure && <FailureCard item={item} {...props} />}
      {item.kind === InboxKind.Plan && (
        <>
          <p className={styles.title}>{item.title}</p>
          <div className={styles.actions}>
            <TaskLink item={item} label={C.confirmPlan} />
          </div>
        </>
      )}
      {item.kind === InboxKind.Delivery && (
        <>
          <p className={styles.title}>{item.title}</p>
          <div className={styles.actions}>
            <TaskLink item={item} label={C.viewResult} />
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
