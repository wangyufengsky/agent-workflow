import { type FunctionalTestCase, type FunctionalTestExecution, FunctionalTestStatus } from '@aw/shared';
import { useEffect, useRef } from 'react';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import styles from './functional-test.module.css';

export function CaseCarousel({
  cases,
  executions,
  selected,
  live,
  onSelect,
  onInteract,
}: {
  cases: FunctionalTestCase[];
  executions: readonly FunctionalTestExecution[];
  selected: string | undefined;
  live: boolean;
  onSelect: (id: string) => void;
  onInteract: () => void;
}) {
  const list = useRef<HTMLFieldSetElement>(null);
  const scrolling = useRef(false);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const pickedByScroll = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (selected === pickedByScroll.current) {
      pickedByScroll.current = undefined;
      return;
    }
    const row = selectedRow.current;
    const viewport = list.current;
    if (row === null || viewport === null) return;
    scrolling.current = false;
    viewport.scrollTop = row.offsetTop + (row.offsetHeight - viewport.clientHeight) / 2;
  }, [selected]);

  function selectCenter(viewport: HTMLFieldSetElement) {
    if (!scrolling.current) return;
    const center = viewport.scrollTop + viewport.clientHeight / 2;
    const index = Array.from(viewport.children).findIndex(
      (row) => row instanceof HTMLElement && row.offsetTop + row.offsetHeight >= center,
    );
    const item = cases[index];
    if (item !== undefined && item.id !== selected) {
      pickedByScroll.current = item.id;
      onSelect(item.id);
    }
  }

  return (
    <fieldset
      ref={list}
      className={styles.carousel}
      data-scrollable={live || cases.length > 5 || undefined}
      aria-label={C.cases}
      onWheel={() => {
        scrolling.current = true;
        onInteract();
      }}
      onPointerDown={() => {
        scrolling.current = true;
      }}
      onScroll={(event) => selectCenter(event.currentTarget)}
      onKeyDown={(event) => {
        const index = cases.findIndex((item) => item.id === selected);
        const target =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? cases.length - 1
              : event.key === 'ArrowUp'
                ? index - 1
                : event.key === 'ArrowDown'
                  ? index + 1
                  : undefined;
        if (target === undefined) return;
        event.preventDefault();
        const next = cases[target];
        if (next !== undefined) {
          onSelect(next.id);
          const button = list.current?.children[target];
          if (button instanceof HTMLButtonElement) button.focus({ preventScroll: true });
        } else {
          onInteract();
        }
      }}
    >
      {cases.map((item) => {
        const execution = executions.findLast((result) => result.caseId === item.id);
        return (
          <button
            type="button"
            key={item.id}
            ref={selected === item.id ? selectedRow : undefined}
            className={styles.caseRow}
            aria-pressed={selected === item.id}
            tabIndex={selected === item.id ? 0 : -1}
            onClick={() => onSelect(item.id)}
          >
            <span className={styles.caseState} data-status={execution?.status}>
              <span aria-hidden="true">
                {execution?.status === FunctionalTestStatus.Passed
                  ? '✓'
                  : execution?.status === FunctionalTestStatus.Failed
                    ? '×'
                    : '·'}
              </span>
            </span>
            <span className={styles.caseTitle}>
              <span className={`mono ${styles.caseNumber}`}>{item.number}</span>
              <strong className="ellipsis">{item.title}</strong>
            </span>
            <span className={styles.sr}>{execution === undefined ? C.pending : C.status[execution.status]}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
