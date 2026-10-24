import type { AcceptanceCheckKind, CheckResult } from '@aw/shared';
import { useState } from 'react';
import { Dialog } from '../../components/dialog.tsx';
import { PAGE_CHECK_COPY as C, PREVIEW_PANE_COPY } from '../../copy/browser.ts';
import styles from './page-check-result.module.css';
import { taskFileUrl, useImage } from './preview.queries.ts';

type PageCheckResult = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.Browser }>;
type Page = PageCheckResult['pages'][number];

/** A page's screenshot as a thumbnail that opens large. */
export function PageShot({ taskId, page }: { taskId: string; page: Page & { screenshot: string } }) {
  const [open, setOpen] = useState(false);
  const src = useImage(taskFileUrl(taskId, page.screenshot));
  const viewport = PREVIEW_PANE_COPY.viewports[page.viewport];
  if (src === null) return <div className={styles.thumb} />;
  return (
    <>
      <button type="button" className={styles.thumb} onClick={() => setOpen(true)}>
        <img src={src} alt={C.enlarge(page.path, viewport)} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={C.shot(page.path, viewport)}>
        <img className={styles.large} src={src} alt={C.shot(page.path, viewport)} />
      </Dialog>
    </>
  );
}

/**
 * A page check's result (29 §8.3): one row per page and viewport with its outcome, errors and warnings, and a
 * screenshot that opens large; or why it could not run, or that it was skipped.
 */
export function PageCheckResultView({ taskId, check }: { taskId: string; check: PageCheckResult }) {
  if (check.skipped) return <p className="hint">{C.skipped}</p>;
  if (check.unrunnable !== null) {
    return (
      <div className="col">
        <p>{C.unrunnable[check.unrunnable.reason]}</p>
        {check.unrunnable.logTail !== '' && (
          <>
            <span className="hint">{C.log}</span>
            <pre className={styles.log}>{check.unrunnable.logTail}</pre>
          </>
        )}
      </div>
    );
  }
  // A preview that ran before and did not start this time: its log is the result (29 §7.4).
  if (check.pages.length === 0) return <pre className={styles.log}>{check.output}</pre>;
  return (
    <ul className={styles.pages} data-testid="page-check">
      {check.pages.map((page) => (
        <li key={`${page.path}@${page.viewport}`} className={styles.page}>
          {page.screenshot !== null && <PageShot taskId={taskId} page={{ ...page, screenshot: page.screenshot }} />}
          <div className={styles.facts}>
            <div className="row">
              <span className="mono">{page.path}</span>
              <span className="hint">{PREVIEW_PANE_COPY.viewports[page.viewport]}</span>
              <span className={page.errors.length === 0 ? styles.ok : styles.bad}>
                {page.errors.length === 0 ? C.passed : C.notPassed}
              </span>
            </div>
            {page.errors.length > 0 && (
              <ul className={styles.findings}>
                {page.errors.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: findings have no identity of their own
                  <li key={i} className={styles.error}>
                    {C.error[e.kind]}：<span className="mono">{e.message}</span>
                    {e.source !== null && <span className="hint"> · {e.source}</span>}
                  </li>
                ))}
              </ul>
            )}
            {page.warnings.length > 0 && (
              <ul className={styles.findings}>
                {page.warnings.map((w, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: findings have no identity of their own
                  <li key={i} className={styles.warning}>
                    {C.warning[w.kind]}
                    {!C.plainWarnings.includes(w.kind) && (
                      <>
                        ：<span className="mono">{w.message}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
