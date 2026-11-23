import {
  FUNCTIONAL_TEST_NODE,
  type FunctionalTestNode,
  type FunctionalTestSnapshot,
  functionalTestReadOp,
  NodeStatus,
  type TaskDetailDTO,
  TaskStatus,
} from '@aw/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { BrowserCaseHandoffPane } from '../browser-cases/browser-case-handoff.tsx';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import { usePlacedTab } from '../preview/use-placed-tab.ts';
import { CaseDefinition } from './case-definition.tsx';
import styles from './functional-test.module.css';
import { FunctionalTestScopeSummary } from './functional-test-fields.tsx';
import { type EvidenceSelection, revisionsFor, TestExecution } from './test-execution.tsx';
import { TestReport } from './test-report.tsx';

const POLL_INTERVAL_MS = 1000;
const N = FUNCTIONAL_TEST_NODE;
const phaseLabel: Record<FunctionalTestNode, string> = {
  [N.Author]: C.author,
  [N.Import]: C.import,
  [N.Environment]: C.prepare,
  [N.Execute]: C.execute,
  [N.Report]: C.report,
};

const terminalNodes: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped, NodeStatus.Cancelled];

function AuthorCases({
  task,
  snapshot,
  importing,
}: {
  task: TaskDetailDTO;
  snapshot: FunctionalTestSnapshot;
  importing: boolean;
}) {
  const [manual, setManual] = useState<string>();
  const items = [...new Map(snapshot.cases.map((item) => [item.id, item])).values()];
  const selected = items.find(({ id }) => id === manual) ?? items.at(-1);
  return (
    <section className={`col ${styles.panel}`} aria-label={importing ? C.import : C.author}>
      <header className="row wrap">
        <h2 className="grow">{importing ? C.import : C.author}</h2>
        {manual !== undefined && (
          <Button size="sm" onClick={() => setManual(undefined)}>
            {importing ? C.followImport : C.followAuthor}
          </Button>
        )}
      </header>
      {selected === undefined ? (
        <p className="hint">{C.noCases}</p>
      ) : (
        <div className={styles.author}>
          <fieldset className="col" aria-label={C.cases}>
            {items.map((item) => (
              <button
                type="button"
                className={styles.caseRow}
                key={item.id}
                aria-pressed={selected.id === item.id}
                onClick={() => setManual(item.id)}
              >
                <span className="mono">{item.number}</span>
                <strong className="ellipsis">{item.title}</strong>
              </button>
            ))}
          </fieldset>
          <CaseDefinition
            key={selected.id}
            taskId={task.id}
            item={selected}
            attachments={task.attachments}
            revisions={revisionsFor(snapshot.events, selected.id)}
          />
        </div>
      )}
    </section>
  );
}

export function FunctionalTestWorkbench({
  task,
  active,
  linkedExecutionId,
}: {
  task: TaskDetailDTO;
  active: boolean;
  linkedExecutionId: string | undefined;
}) {
  const [pickedPhase, setPickedPhase] = useState<FunctionalTestNode | undefined>(
    linkedExecutionId === undefined ? undefined : N.Execute,
  );
  const [pickedRun, setPickedRun] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceSelection>();
  const [showLinkedEvidence, setShowLinkedEvidence] = useState(linkedExecutionId !== undefined);
  const [executionView, setExecutionView] = useState(0);
  const [reviewingExecution, setReviewingExecution] = useState(false);
  const handoffArea = useRef<HTMLDivElement>(null);
  const handoff = task.browserCaseHandoff;
  const running = task.status === TaskStatus.Running;
  const queryClient = useQueryClient();
  const queryKey = queryKeys.functionalTest(task.id);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const previous = queryClient.getQueryData<FunctionalTestSnapshot>(queryKey);
      const snapshot = await callOperation(functionalTestReadOp, {
        taskId: task.id,
        ...(previous === undefined ? {} : { after: previous.nextAfter }),
      });
      return previous === undefined || snapshot.nextAfter < previous.nextAfter
        ? snapshot
        : { ...snapshot, events: [...previous.events, ...snapshot.events] };
    },
    enabled: active,
    refetchInterval: active && running ? POLL_INTERVAL_MS : false,
  });
  usePlacedTab(active && query.isSuccess ? (handoff?.tabId ?? null) : null, handoffArea);
  const scope = task.functionalTest;
  if (scope === undefined) return null;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
  const snapshot = query.data;
  const source = scope.caseAttachmentIds.length === 0 ? N.Author : N.Import;
  const phases = [source, N.Environment, N.Execute, N.Report];
  const nextPhase = phases.find((phase) =>
    task.nodes.some(({ key, status }) => key === phase && !terminalNodes.includes(status)),
  );
  const automatic = nextPhase ?? (snapshot.reports.length > 0 ? N.Report : source);
  const phase = pickedPhase ?? (reviewingExecution ? N.Execute : automatic);
  const phaseNodeId = task.nodes.find(({ key }) => key === phase)?.id;
  const linkedExecution = showLinkedEvidence
    ? snapshot.executions.find(({ id }) => id === linkedExecutionId)
    : undefined;
  const run = snapshot.runs.find(({ id }) => id === (pickedRun ?? linkedExecution?.runId)) ?? snapshot.runs.at(-1);
  const environment = run?.environment;
  const selectPhase = (next: FunctionalTestNode | undefined) => {
    setPickedPhase(next);
    setShowLinkedEvidence(false);
    setEvidence(undefined);
    setReviewingExecution(false);
  };
  return (
    <div className={styles.workbench}>
      <div className="row wrap">
        <nav className={`grow ${styles.phaseBar}`} aria-label={C.phases}>
          {phases.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={phase === item ? 'primary' : 'ghost'}
              aria-pressed={phase === item}
              onClick={() => selectPhase(item)}
            >
              {phaseLabel[item]}
            </Button>
          ))}
          {pickedPhase !== undefined && (
            <Button size="sm" onClick={() => selectPhase(undefined)}>
              {C.followPhase}
            </Button>
          )}
        </nav>
        {snapshot.runs.length > 1 && (
          <select
            className="input"
            aria-label={C.run}
            value={run?.id}
            onChange={(event) => {
              setPickedRun(event.target.value);
              setShowLinkedEvidence(false);
            }}
          >
            {snapshot.runs.map((item, index) => (
              <option key={item.id} value={item.id}>
                {C.runLabel(index + 1, item.environment.baseline ?? C.baselineUnverified)}
              </option>
            ))}
          </select>
        )}
      </div>
      <details className={styles.panel}>
        <summary>{C.scope}</summary>
        <FunctionalTestScopeSummary scope={scope} />
        {scope.caseAttachmentIds.length > 0 && (
          <p>
            {C.caseInputs} ·{' '}
            {task.attachments
              .filter(({ id }) => scope.caseAttachmentIds.includes(id))
              .map(({ name }) => name)
              .join('、')}
          </p>
        )}
      </details>
      {handoff !== undefined && (
        <section className={`col ${styles.panel}`}>
          <BrowserCaseHandoffPane taskId={task.id} handoff={handoff} />
          {window.aw !== undefined && <div ref={handoffArea} className={styles.handoffSurface} />}
        </section>
      )}
      {(phase === N.Author || phase === N.Import) && (
        <AuthorCases task={task} snapshot={snapshot} importing={phase === N.Import} />
      )}
      {phase === N.Environment && (
        <section className={`col ${styles.panel}`} aria-label={C.prepare}>
          <h2>{C.prepare}</h2>
          {environment === undefined ? (
            <p className="hint">{C.noEnvironment}</p>
          ) : (
            <>
              <p>
                {C.environment} · {environment.target}
              </p>
              <p>
                {C.baseline} · {environment.baseline ?? C.baselineUnverified}
                {!environment.verified && environment.baseline !== null ? ` · ${C.baselineUnverified}` : ''}
              </p>
              {environment.reason !== null && <p>{environment.reason}</p>}
              {environment.logTail !== '' && <pre>{environment.logTail}</pre>}
            </>
          )}
          {phaseNodeId !== undefined && (
            <FrontendActivity task={task} nodeId={phaseNodeId} inMain={false} starting={false} />
          )}
        </section>
      )}
      {phase === N.Execute && (
        <TestExecution
          key={`${run?.id}:${executionView}`}
          task={task}
          snapshot={snapshot}
          runId={run?.id}
          initialSelection={
            evidence ??
            (linkedExecution === undefined
              ? undefined
              : { caseId: linkedExecution.caseId, executionId: linkedExecution.id })
          }
          onReviewChange={setReviewingExecution}
          live={active && running && run?.id === snapshot.runs.at(-1)?.id}
        />
      )}
      {phase === N.Report &&
        phaseNodeId !== undefined &&
        running &&
        snapshot.reports.every(({ runId }) => runId !== run?.id) && (
          <FrontendActivity task={task} nodeId={phaseNodeId} inMain={false} starting={false} />
        )}
      {phase === N.Report && (
        <TestReport
          key={run?.id}
          task={task}
          reports={snapshot.reports.filter(({ runId }) => runId === run?.id)}
          onEvidence={(caseId, executionId) => {
            setEvidence({ caseId, executionId });
            setExecutionView((epoch) => epoch + 1);
            setPickedPhase(N.Execute);
          }}
        />
      )}
    </div>
  );
}
