import type { FunctionalTestEvent } from '@aw/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { StepScreenshot } from '../browser-cases/browser-case-report.tsx';
import styles from './functional-test.module.css';

const json = (value: unknown) => JSON.stringify(value) ?? C.noValue;

function requestLabel(event: FunctionalTestEvent): string {
  const { method, path, title, action } = event.detail;
  if (typeof method === 'string' && typeof path === 'string') return `${method} ${path}`;
  const target =
    action !== null && typeof action === 'object' && !Array.isArray(action)
      ? (action.selector ?? action.path)
      : undefined;
  return [typeof title === 'string' ? title : event.message, typeof target === 'string' ? target : undefined]
    .filter(Boolean)
    .join(' · ');
}

function matchingResult(event: FunctionalTestEvent, events: readonly FunctionalTestEvent[]) {
  return event.kind === 'action'
    ? events.find(({ kind, step, seq }) => kind === 'result' && step === event.step && seq > event.seq)
    : undefined;
}

function eventText(event: FunctionalTestEvent, result?: FunctionalTestEvent) {
  const { field, expected, actual, passed, status } = event.detail;
  switch (event.kind) {
    case 'action': {
      const code = result?.detail.status;
      const elapsed = result?.detail.elapsedMs;
      return [
        requestLabel(event),
        result === undefined ? C.waitingResponse : typeof code === 'number' ? String(code) : result.message,
        typeof elapsed === 'number' ? C.elapsed(elapsed) : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'assertion':
      return C.assertionLine(typeof field === 'string' ? field : event.message, json(expected), json(actual), passed);
    case 'result':
      return typeof status === 'number' ? `${event.message} · HTTP ${status}` : event.message;
    default:
      return event.message;
  }
}

function EventPayload({ event, result }: { event: FunctionalTestEvent; result?: FunctionalTestEvent | undefined }) {
  const { screenshot, attemptId } = (result ?? event).detail;
  return (
    <div className={styles.eventPayload}>
      <p className="hint">
        <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
        {event.step === null ? '' : ` · ${C.step(event.step + 1)}`}
      </p>
      {Object.keys(event.detail).length > 0 && <pre className="mono">{JSON.stringify(event.detail, null, 2)}</pre>}
      {result !== undefined && <pre className="mono">{JSON.stringify(result.detail, null, 2)}</pre>}
      {typeof screenshot === 'string' && typeof attemptId === 'string' && (
        <StepScreenshot attemptId={attemptId} file={screenshot} />
      )}
    </div>
  );
}

export function TestRequests({
  events,
  allEvents,
}: {
  events: readonly FunctionalTestEvent[];
  allEvents: readonly FunctionalTestEvent[];
}) {
  return events
    .filter(({ kind }) => kind === 'action')
    .map((event) => {
      const method = typeof event.detail.method === 'string' ? event.detail.method : undefined;
      const path = typeof event.detail.path === 'string' ? event.detail.path : undefined;
      const result = matchingResult(event, allEvents);
      return (
        <details className={styles.request} key={event.seq}>
          <summary>
            {method !== undefined && path !== undefined ? (
              <>
                <code className={styles.method}>{method}</code>
                <code className={styles.requestPath}>{path}</code>
              </>
            ) : (
              <span>{requestLabel(event)}</span>
            )}
            <Icon name="chevRight" size="sm" />
          </summary>
          <EventPayload event={event} result={result} />
        </details>
      );
    });
}

export function TestAssertions({ events }: { events: readonly FunctionalTestEvent[] }) {
  const assertions = events.filter(({ kind }) => kind === 'assertion');
  return (
    <section className={styles.assertions} aria-label={C.assertions}>
      <h4>{C.assertions}</h4>
      {assertions.length === 0 ? (
        <p className="hint">{C.noAssertions}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">{C.assertionField}</th>
              <th scope="col">{C.expected}</th>
              <th scope="col">{C.actual}</th>
            </tr>
          </thead>
          <tbody>
            {assertions.map(({ seq, detail }) => (
              <tr key={seq} data-result={detail.passed === false ? 'failed' : undefined}>
                <th scope="row">
                  <code>{typeof detail.field === 'string' ? detail.field : C.noValue}</code>
                </th>
                <td>
                  <code>{json(detail.expected)}</code>
                </td>
                <td>
                  <code>{json(detail.actual)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ActivityEntries({
  events,
  allEvents,
  expand = false,
}: {
  events: readonly FunctionalTestEvent[];
  allEvents: readonly FunctionalTestEvent[];
  expand?: boolean;
}) {
  if (events.length === 0) return <p className={`hint ${styles.empty}`}>{C.noEvidence}</p>;
  return (
    <div className={styles.activityEntries}>
      {events.map((event) => {
        const result = matchingResult(event, allEvents);
        return (
          <details key={event.seq} className={styles.event} open={expand || undefined}>
            <summary>
              <span className={styles.activityDot} aria-hidden="true" />
              <span>{eventText(event, result)}</span>
              <Icon name="chevRight" size="sm" />
            </summary>
            <EventPayload event={event} result={result} />
          </details>
        );
      })}
    </div>
  );
}

export function SelectedCaseActivity({
  caseNumber,
  events,
  allEvents,
}: {
  caseNumber: string;
  events: readonly FunctionalTestEvent[];
  allEvents: readonly FunctionalTestEvent[];
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) opener.current?.focus();
  }
  return (
    <aside className={styles.panel} aria-label={C.actions}>
      <header className={styles.panelHead}>
        <h3>{C.actions}</h3>
        <button ref={opener} type="button" className={styles.textButton} onClick={() => setOpen(true)}>
          {C.fullDetails} <Icon name="external" size="sm" />
        </button>
      </header>
      <ActivityEntries events={events} allEvents={allEvents} />
      <Dialog
        open={open}
        onOpenChange={changeOpen}
        title={`${C.actions} · ${caseNumber}`}
        footer={<Button onClick={() => changeOpen(false)}>{COMMON_COPY.close}</Button>}
      >
        <ActivityEntries events={allEvents} allEvents={allEvents} expand />
      </Dialog>
    </aside>
  );
}

export function TestTerminal({
  events,
  caseLabel,
  follow,
}: {
  events: readonly FunctionalTestEvent[];
  caseLabel: string;
  follow: boolean;
}) {
  const stream = useRef<HTMLOListElement>(null);
  const lastSeq = events.at(-1)?.seq;
  useEffect(() => {
    if (follow && lastSeq !== undefined && stream.current !== null)
      stream.current.scrollTop = stream.current.scrollHeight;
  }, [follow, lastSeq]);
  return (
    <section className={styles.console} aria-label={C.console}>
      <header>
        <Icon name="terminal" size="sm" />
        <h4>{C.console}</h4>
        <code>{caseLabel}</code>
      </header>
      {events.length === 0 ? (
        <p className={styles.empty}>{C.noEvidence}</p>
      ) : (
        <ol ref={stream} className={styles.consoleLines}>
          {events.map((event, index) => (
            <li
              key={event.seq}
              data-result={
                event.detail.passed === false ? 'failed' : event.detail.passed === true ? 'passed' : undefined
              }
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <details className={styles.event}>
                <summary>{event.kind === 'action' ? `→ ${requestLabel(event)}` : eventText(event)}</summary>
                <EventPayload event={event} />
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
