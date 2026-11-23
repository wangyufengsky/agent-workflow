import {
  type FunctionalTestEvent,
  type FunctionalTestSnapshot,
  FunctionalTestStatus,
  type TaskDetailDTO,
} from '@aw/shared';
import { useEffect, useRef, useState } from 'react';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { CaseCarousel } from './case-carousel.tsx';
import { CaseDefinition } from './case-definition.tsx';
import styles from './functional-test.module.css';
import { SelectedCaseActivity, TestAssertions, TestRequests, TestTerminal } from './test-events.tsx';
import { TestFollowUp } from './test-follow-up.tsx';

const FOLLOW_AFTER_MS = 5000;
export type EvidenceSelection = { caseId: string; executionId?: string };

export function TestExecution({
  task,
  snapshot,
  runId,
  initialSelection,
  onReviewChange,
  live,
}: {
  task: TaskDetailDTO;
  snapshot: FunctionalTestSnapshot;
  runId: string | undefined;
  initialSelection: EvidenceSelection | undefined;
  onReviewChange: (reviewing: boolean) => void;
  live: boolean;
}) {
  const [manual, setManual] = useState(initialSelection);
  const [lastInteraction, setLastInteraction] = useState(() => Date.now());
  const tracking = useRef(false);
  const executions = snapshot.executions.filter((execution) => execution.runId === runId);
  const running = executions.findLast(({ status }) => status === FunctionalTestStatus.Running);
  const current = running ?? executions.at(-1);
  const caseIds = new Set(snapshot.cases.map(({ id }) => id));
  const items = [...caseIds].flatMap((id) => {
    const item = snapshot.cases.findLast((entry) => entry.id === id);
    return item === undefined ? [] : [item];
  });
  const currentCase = items.find(({ id }) => id === running?.caseId);
  const selected = manual?.caseId ?? current?.caseId ?? items[0]?.id;
  const outcomes = executions.filter((execution) => execution.caseId === selected);
  const execution = outcomes.find(({ id }) => id === manual?.executionId) ?? outcomes.at(-1);
  const item =
    snapshot.cases.findLast((entry) => entry.id === selected && entry.version === execution?.version) ??
    items.find(({ id }) => id === selected);
  const events = snapshot.events.filter((event) => execution !== undefined && event.executionId === execution.id);
  const activity = events.filter(({ kind }) => kind !== 'assertion' && kind !== 'environment');

  useEffect(() => {
    if (!live || manual === undefined) return;
    let timer: number;
    const resume = () => {
      if (
        tracking.current ||
        window.getSelection()?.isCollapsed === false ||
        document.querySelector('[role="dialog"][data-state="open"]') !== null
      ) {
        timer = window.setTimeout(resume, FOLLOW_AFTER_MS);
      } else {
        setManual(undefined);
        onReviewChange(false);
      }
    };
    timer = window.setTimeout(resume, Math.max(0, FOLLOW_AFTER_MS - (Date.now() - lastInteraction)));
    return () => window.clearTimeout(timer);
  }, [lastInteraction, live, manual, onReviewChange]);

  useEffect(() => {
    const release = () => {
      tracking.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  function stayHere() {
    if (selected === undefined) return;
    setManual((previous) => previous ?? { caseId: selected });
    onReviewChange(true);
    setLastInteraction(Date.now());
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只监听子控件的交互，用于延长回看。
    <div
      className={styles.executionLayout}
      onWheel={stayHere}
      onKeyDown={stayHere}
      onPointerDown={() => {
        tracking.current = true;
        stayHere();
      }}
      onPointerUp={() => {
        tracking.current = false;
        stayHere();
      }}
      onPointerCancel={() => {
        tracking.current = false;
        stayHere();
      }}
      onToggle={stayHere}
    >
      <section className={styles.panel} aria-label={C.execute}>
        <header className={styles.panelHead}>
          <h2>{C.cases}</h2>
          <small>{items.length}</small>
        </header>
        {items.length === 0 ? (
          <p className={`hint ${styles.empty}`}>{C.noCases}</p>
        ) : (
          <CaseCarousel
            cases={items}
            executions={executions}
            selected={selected}
            live={live}
            onInteract={stayHere}
            onSelect={(caseId) => {
              setManual((previous) => (previous?.caseId === caseId ? previous : { caseId }));
              setLastInteraction(Date.now());
              onReviewChange(true);
            }}
          />
        )}
        <footer className={styles.panelFoot}>
          {live && currentCase !== undefined ? (
            <span className={styles.running} role="status">
              {C.runningCase(currentCase.number)}
            </span>
          ) : (
            <span>{C.caseCount(items.length)}</span>
          )}
          {live && manual !== undefined && (
            <button
              className={styles.textButton}
              type="button"
              onClick={() => {
                setManual(undefined);
                onReviewChange(false);
              }}
            >
              {C.followLive}
            </button>
          )}
        </footer>
      </section>
      {item !== undefined && (
        <>
          <article className={styles.panel}>
            <div className={styles.evidenceBody}>
              <div className={`mono ${styles.caseNumber}`}>
                {item.number} / v{item.version}
              </div>
              <header className={styles.evidenceHeader}>
                <h3>{item.title}</h3>
                <span className={styles.statusBadge} data-status={execution?.status}>
                  {execution === undefined ? C.pending : C.status[execution.status]}
                </span>
              </header>
              <p className="hint">{item.requirement}</p>
              {outcomes.length > 1 && (
                <select
                  className="input"
                  aria-label={C.execution}
                  value={execution?.id}
                  onChange={(event) => {
                    setManual({ caseId: item.id, executionId: event.target.value });
                    setLastInteraction(Date.now());
                    onReviewChange(true);
                  }}
                >
                  {outcomes.map((outcome, index) => (
                    <option key={outcome.id} value={outcome.id}>
                      {C.executionLabel(index + 1, outcome.version, C.status[outcome.status])}
                    </option>
                  ))}
                </select>
              )}
              <TestRequests events={events} allEvents={events} />
              <TestAssertions events={events} />
            </div>
            <TestTerminal
              events={events}
              caseLabel={`${item.number} · v${item.version}`}
              follow={live && manual === undefined}
            />
            <details className={styles.inspector}>
              <summary>{C.steps}</summary>
              <CaseDefinition
                taskId={task.id}
                item={item}
                attachments={task.attachments}
                revisions={revisionsFor(snapshot.events, item.id)}
              />
            </details>
            {execution?.status === FunctionalTestStatus.Failed && (
              <div className={styles.evidenceFoot}>
                <TestFollowUp key={execution.id} task={task} executionIds={[execution.id]} />
              </div>
            )}
          </article>
          <SelectedCaseActivity
            key={execution?.id ?? item.id}
            caseNumber={item.number}
            events={activity}
            allEvents={events}
          />
        </>
      )}
    </div>
  );
}

export const revisionsFor = (events: readonly FunctionalTestEvent[], id: string) =>
  events.filter(({ caseId, kind }) => caseId === id && kind === 'revision');
