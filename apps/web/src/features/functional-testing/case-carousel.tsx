import type { FunctionalTestCase, FunctionalTestExecution } from '@aw/shared';
import { useEffect, useRef } from 'react';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import styles from './functional-test.module.css';

export function CaseCarousel({
  cases,
  executions,
  selected,
  onSelect,
  onInteract,
}: {
  cases: FunctionalTestCase[];
  executions: readonly FunctionalTestExecution[];
  selected: string | undefined;
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
    if (item !== undefined) {
      pickedByScroll.current = item.id;
      onSelect(item.id);
    }
  }

  return (
    <fieldset
      ref={list}
      className={styles.carousel}
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
        const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (offset === 0) return;
        event.preventDefault();
        const index = cases.findIndex((item) => item.id === selected);
        const next = cases[index + offset];
        if (next !== undefined) {
          onSelect(next.id);
          const button = list.current?.children[index + offset];
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
            onClick={() => onSelect(item.id)}
          >
            <span className="mono">{item.number}</span>
            <strong className="ellipsis">{item.title}</strong>
            <span data-status={execution?.status}>
              {execution === undefined ? C.pending : C.status[execution.status]}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
