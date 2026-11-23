import type { FunctionalTestEvent } from '@aw/shared';
import { useEffect, useRef } from 'react';
import { formatDateTime } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { StepScreenshot } from '../browser-cases/browser-case-report.tsx';
import styles from './functional-test.module.css';

function matchingResult(event: FunctionalTestEvent, events: readonly FunctionalTestEvent[]) {
  return event.kind === 'action'
    ? events.find(({ kind, step, seq }) => kind === 'result' && step === event.step && seq > event.seq)
    : undefined;
}

function eventText(event: FunctionalTestEvent, result: FunctionalTestEvent | undefined) {
  if (event.kind !== 'action') return event.message;
  const { method, path, title } = event.detail;
  const request = typeof method === 'string' && typeof path === 'string' ? `${method} ${path}` : undefined;
  const label = typeof title === 'string' ? title : event.message;
  const status = result?.detail.status;
  const elapsed = result?.detail.elapsedMs;
  return [
    label,
    request,
    result === undefined ? C.waitingResponse : typeof status === 'number' ? String(status) : result.message,
    typeof elapsed === 'number' ? C.elapsed(elapsed) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function TestEvents({
  label,
  events,
  allEvents,
  consoleView = false,
  follow = false,
}: {
  label: string;
  events: readonly FunctionalTestEvent[];
  allEvents: readonly FunctionalTestEvent[];
  consoleView?: boolean;
  follow?: boolean;
}) {
  const stream = useRef<HTMLDivElement>(null);
  const lastSeq = events.at(-1)?.seq;
  useEffect(() => {
    if (follow && lastSeq !== undefined && stream.current !== null) {
      stream.current.scrollTop = stream.current.scrollHeight;
    }
  }, [follow, lastSeq]);
  return (
    <section className={`col ${styles.panel} ${consoleView ? styles.console : ''}`} aria-label={label}>
      <h3>{label}</h3>
      {events.length === 0 ? (
        <p className="hint">{C.noEvidence}</p>
      ) : (
        <div className={styles.stream} ref={stream}>
          {events.map((event) => {
            const result = matchingResult(event, allEvents);
            const { screenshot, attemptId } = (result ?? event).detail;
            return (
              <details key={event.seq} className={styles.event}>
                <summary>
                  <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
                  {' · '}
                  {event.step === null ? '' : `${C.step(event.step + 1)} · `}
                  {eventText(event, result)}
                </summary>
                <pre className="mono">{JSON.stringify(event.detail, null, 2)}</pre>
                {result !== undefined && <pre className="mono">{JSON.stringify(result.detail, null, 2)}</pre>}
                {typeof screenshot === 'string' && typeof attemptId === 'string' && (
                  <StepScreenshot attemptId={attemptId} file={screenshot} />
                )}
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
