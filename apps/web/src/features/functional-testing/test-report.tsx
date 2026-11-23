import {
  DeliveryStrategy,
  type FunctionalTestReport,
  FunctionalTestStatus,
  functionalTestReadOp,
  type TaskDetailDTO,
  TaskStatus,
} from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { saveBytes } from '../../app/save-file.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { DELIVERY_COPY } from '../../copy/delivery.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { useDeliver } from '../tasks/tasks.queries.ts';
import styles from './functional-test.module.css';
import { TestFollowUp } from './test-follow-up.tsx';

function RunComparison({
  report,
  sourceId,
  executionIds,
}: {
  report: FunctionalTestReport;
  sourceId: string;
  executionIds: string[];
}) {
  const original = useQuery({
    queryKey: ['functional-test-comparison', sourceId],
    queryFn: () => callOperation(functionalTestReadOp, { taskId: sourceId }),
  });
  if (original.isError) return <ErrorState error={original.error} onRetry={() => void original.refetch()} />;
  if (original.data === undefined) return null;
  const snapshot = original.data;
  const previous = snapshot.executions.filter(({ id }) => executionIds.includes(id));
  return (
    <section className="col" aria-label={C.comparison}>
      <h3>{C.comparison}</h3>
      <ul className={styles.items}>
        {previous.map((execution) => {
          const current = report.items.find(
            ({ caseId, version }) => caseId === execution.caseId && version === execution.version,
          );
          const baseline = snapshot.runs.find(({ id }) => id === execution.runId)?.environment.baseline;
          return (
            <li key={execution.id} className="row wrap">
              <span>
                {current?.number ?? execution.caseId} · {C.version(execution.version)}
              </span>
              <span>
                {C.originalResult(C.status[execution.status])} · {baseline ?? C.baselineUnverified}
              </span>
              <span>{C.retestResult(current === undefined ? C.status.not_run : C.status[current.status])}</span>
              <Link
                className="btn sm"
                to={ROUTES.task}
                params={{ taskId: sourceId }}
                search={{ view: 'result', testExecution: execution.id }}
              >
                {C.originalEvidence}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TestReport({
  task,
  reports,
  onEvidence,
}: {
  task: TaskDetailDTO;
  reports: readonly FunctionalTestReport[];
  onEvidence: (caseId: string, executionId: string) => void;
}) {
  const [version, setVersion] = useState<number>();
  const finish = useDeliver();
  const [selected, setSelected] = useState<string[]>([]);
  const report = reports.find((item) => item.version === version) ?? reports.at(-1);
  const exportFile = useMutation({
    mutationFn: (item: FunctionalTestReport) =>
      saveBytes(`${task.key}-${item.runId}-v${item.version}.md`, new TextEncoder().encode(item.markdown)),
  });
  if (report === undefined) return <p className="hint">{C.noReport}</p>;
  const origin = task.testLinks?.find(({ taskId, kind }) => taskId === task.id && kind === 'rerun');
  const failed = report.items.filter((item) => item.status === FunctionalTestStatus.Failed);
  const selectedFailures = failed.flatMap(({ executionId }) =>
    executionId !== null && selected.includes(executionId) ? [executionId] : [],
  );
  return (
    <section className={`col ${styles.panel}`} aria-label={C.report}>
      <header className="row wrap">
        <h2 className="grow">{C.report}</h2>
        {reports.length > 1 && (
          <select
            className="input"
            aria-label={C.revision}
            value={report.version}
            onChange={(event) => {
              setVersion(Number(event.target.value));
              setSelected([]);
            }}
          >
            {reports.map((item) => (
              <option value={item.version} key={item.version}>
                {C.version(item.version)}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" pending={exportFile.isPending} onClick={() => exportFile.mutate(report)}>
          {C.export}
        </Button>
      </header>
      {exportFile.isError && <ErrorState error={exportFile.error} />}
      {finish.isError && <ErrorState error={finish.error} />}
      <Markdown source={report.markdown} />
      {origin !== undefined && (
        <RunComparison report={report} sourceId={origin.sourceId} executionIds={origin.executionIds} />
      )}
      {report.items.some(({ executionId }) => executionId !== null) && (
        <ul className={styles.items}>
          {report.items.map(
            ({ caseId, executionId, number, title, status, version }) =>
              executionId !== null && (
                <li key={executionId} className="row wrap">
                  {status === FunctionalTestStatus.Failed && (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(executionId)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((ids) =>
                            checked ? [...ids, executionId] : ids.filter((id) => id !== executionId),
                          );
                        }}
                      />
                      {C.includeRepair(number)}
                    </label>
                  )}
                  <span>
                    {number} · {title} · {C.version(version)} · {C.status[status]}
                  </span>
                  <Button size="sm" onClick={() => onEvidence(caseId, executionId)}>
                    {C.evidence}
                  </Button>
                </li>
              ),
          )}
        </ul>
      )}
      {failed.length > 0 && <TestFollowUp task={task} executionIds={selectedFailures} />}
      {task.status === TaskStatus.Review && (
        <div className="row">
          <Button
            variant="primary"
            pending={finish.isPending}
            onClick={() => finish.mutate({ id: task.id, strategy: DeliveryStrategy.ReportOnly })}
          >
            {DELIVERY_COPY.complete}
          </Button>
        </div>
      )}
    </section>
  );
}
