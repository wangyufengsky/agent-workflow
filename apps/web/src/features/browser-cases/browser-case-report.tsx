import type { BrowserCase, BrowserCaseStepResult, BrowserCaseReport as Report } from '@aw/shared';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { attemptFileUrl, useImage } from '../preview/preview.queries.ts';
import styles from './browser-case-report.module.css';

export function StepScreenshot({ attemptId, file }: { attemptId: string; file: string }) {
  const src = useImage(attemptFileUrl(attemptId, file));
  return src === null ? null : (
    <figure className={styles.evidence}>
      <img src={src} alt={C.evidence} />
      <figcaption>
        <a className="btn sm" href={src} download={file}>
          {C.saveEvidence}
        </a>
      </figcaption>
    </figure>
  );
}

export function StepRequests({ requests }: { requests: BrowserCaseStepResult['requests'] }) {
  return (
    <details>
      <summary>
        {C.requests} · {requests.length}
      </summary>
      {requests.length === 0 ? (
        <p className="hint">{C.noRequests}</p>
      ) : (
        <ul className={styles.requests}>
          {requests.map((request, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 报告里的请求序号固定，同一地址可被请求多次。
            <li key={`${index}:${request.method}:${request.url}`} className="mono">
              {request.method} {request.url} ·{' '}
              {request.blocked !== null
                ? C.blockedRequest
                : (request.status ?? (request.failed ? C.failedRequest : C.pendingRequest))}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function BrowserCaseReport({ test, report }: { test: BrowserCase; report: Report }) {
  return (
    <section className="col" aria-label={C.title}>
      <h3 className="sec-t">
        {test.name} · {C.revision(test.revision)} · {C.outcome[report.outcome]}
      </h3>
      <ol className={styles.steps}>
        {[null, ...test.steps].map((definition, index) => {
          const result = report.steps[index];
          const actual = result?.actual;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 步骤序号对应本次运行写入的不可变用例快照。
            <li key={index} className={styles.step}>
              <strong>
                {definition === null ? C.opening : `${C.step(index)} · ${definition.title}`} ·{' '}
                {result === undefined ? C.notRun : C.outcome[result.outcome]}
              </strong>
              {definition !== null && (
                <p>
                  {C.action} · {C.actions[definition.action.kind]}
                  {'selector' in definition.action ? ` · ${definition.action.selector}` : ''}
                </p>
              )}
              {definition !== null && (
                <p>
                  {C.expected} · {C.expectation(definition.expect)}
                </p>
              )}
              {definition !== null && result !== undefined && (
                <p>
                  {C.actual} · {typeof actual === 'boolean' ? (actual ? C.true : C.false) : (actual ?? C.missing)}
                </p>
              )}
              {result?.errorCode != null && <p className="hint">{ERROR_COPY[result.errorCode]}</p>}
              {result?.screenshot != null && <StepScreenshot attemptId={report.attemptId} file={result.screenshot} />}
              {result !== undefined && <StepRequests requests={result.requests} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
