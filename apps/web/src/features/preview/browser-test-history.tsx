import type { BrowserTestAction } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PREVIEW_PANE_COPY } from '../../copy/browser.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { BROWSER_TEST_COPY as C } from '../../copy/tasks.ts';
import { StepRequests } from '../browser-cases/browser-case-report.tsx';
import styles from './browser-test-pane.module.css';
import { testActionsQuery } from './preview.queries.ts';

function actionName(action: BrowserTestAction): string {
  return C.recordTool[action.tool] ?? action.tool;
}

export function BrowserTestHistory({ attemptId }: { attemptId: string }) {
  const actions = useQuery(testActionsQuery(attemptId));
  const [filter, setFilter] = useState<'all' | 'failed' | 'requests'>('all');
  const [picked, setPicked] = useState<number | null>(null);
  const [readingSince, setReadingSince] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const previousHeight = useRef(0);
  const items = actions.data ?? [];
  const latest = items.at(-1)?.seq ?? 0;
  const failed = items.filter((item) => !item.passed);
  const withRequests = items.filter((item) => item.requests.length > 0);
  const visible = filter === 'failed' ? failed : filter === 'requests' ? withRequests : items;
  const active = visible.find((item) => item.seq === picked) ?? visible.at(-1);
  const added = readingSince === null ? 0 : Math.max(0, latest - readingSince);
  // 新记录从顶部插入。读历史时抵消增加的高度，网页和列表中的阅读位置都不跳。
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null || visible.length === 0) {
      previousHeight.current = 0;
      return;
    }
    const height = element.scrollHeight;
    if (readingSince === null) element.scrollTop = 0;
    else if (previousHeight.current !== 0) element.scrollTop += height - previousHeight.current;
    previousHeight.current = height;
  }, [readingSince, visible.length]);

  function backToLatest() {
    setReadingSince(null);
    setPicked(null);
    if (list.current !== null) list.current.scrollTop = 0;
  }

  return (
    <div className={styles.history}>
      <fieldset className={styles.filters} aria-label={C.actions}>
        {(
          [
            ['all', C.allActions, items.length],
            ['failed', C.failedActions, failed.length],
            ['requests', C.withRequests, withRequests.length],
          ] as const
        ).map(([key, label, count]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'brand' : 'ghost'}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              backToLatest();
            }}
          >
            {label} {count}
          </Button>
        ))}
      </fieldset>
      {actions.isError ? (
        <ErrorState error={actions.error} />
      ) : (
        <ol
          ref={list}
          className={styles.actionList}
          data-testid="browser-test-action-list"
          onScroll={(event) => {
            if (event.currentTarget.scrollTop > 4) setReadingSince((since) => since ?? latest);
          }}
        >
          {visible.toReversed().map((item) => (
            <li key={item.seq}>
              <button
                className={styles.action}
                type="button"
                aria-current={active?.seq === item.seq}
                onClick={() => {
                  setPicked(item.seq);
                  if (item.seq !== latest) setReadingSince((since) => since ?? latest);
                }}
              >
                <span className={styles.sequence}>{item.seq}</span>
                <span className={styles.actionName}>
                  <strong title={item.target}>
                    {actionName(item)}
                    {item.target === undefined ? '' : ` · ${item.target}`}
                  </strong>
                  <span className="hint">
                    {item.path}
                    {item.requests.length > 0 ? ` · ${C.requestCount(item.requests.length)}` : ''}
                  </span>
                </span>
                <span data-passed={item.passed} className={styles.outcome}>
                  {item.passed ? C.actionPassed : C.actionFailed}
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="hint">{items.length === 0 ? C.noActions : C.noMatchingActions}</li>}
        </ol>
      )}
      {active !== undefined && (
        <section className={styles.detail} aria-label={actionName(active)}>
          <div className={styles.detailTitle}>
            <strong>
              {actionName(active)}
              {active.target === undefined ? '' : ` · ${active.target}`} <span className="mono">{active.path}</span>
            </strong>
            <span className={styles.outcome} data-passed={active.passed}>
              {active.passed ? C.actionPassed : C.actionFailed}
            </span>
          </div>
          {active.errorCode !== null && <p className="hint">{ERROR_COPY[active.errorCode]}</p>}
          {active.requests.length === 0 ? (
            <p className="hint">{C.noRequests}</p>
          ) : (
            <StepRequests key={active.seq} requests={active.requests} expanded />
          )}
        </section>
      )}
      <div className={styles.follow}>
        <span className="hint">
          {added > 0 ? C.newActions(added) : readingSince === null ? C.follow : C.readingHistory}
        </span>
        <Button size="sm" variant="ghost" onClick={backToLatest} disabled={readingSince === null}>
          {PREVIEW_PANE_COPY.latest}
        </Button>
      </div>
    </div>
  );
}
