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
import { useEffect, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import type { IconName } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { BrowserCaseHandoffPane } from '../browser-cases/browser-case-handoff.tsx';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import { usePlacedTab } from '../preview/use-placed-tab.ts';
import { CaseDefinition } from './case-definition.tsx';
import styles from './functional-test.module.css';
import { FunctionalTestScopeSummary } from './functional-test-fields.tsx';
import { TestEnvironment } from './test-environment.tsx';
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

const phaseIcon: Record<FunctionalTestNode, IconName> = {
  [N.Author]: 'edit',
  [N.Import]: 'file',
  [N.Environment]: 'server',
  [N.Execute]: 'play',
  [N.Report]: 'file',
};

const terminalNodes: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped, NodeStatus.Cancelled];

function PhaseActivity({
  task,
  nodeId,
  expandActions = false,
}: {
  task: TaskDetailDTO;
  nodeId: string | undefined;
  expandActions?: boolean;
}) {
  if (nodeId === undefined) return null;
  return (
    <aside className={`${styles.panel} ${styles.phaseActivity}`} aria-label={C.actions}>
      <FrontendActivity task={task} nodeId={nodeId} inMain={false} starting={false} expandActions={expandActions} />
    </aside>
  );
}

function AuthorCases({
  task,
  snapshot,
  importing,
  nodeId,
}: {
  task: TaskDetailDTO;
  snapshot: FunctionalTestSnapshot;
  importing: boolean;
  nodeId: string | undefined;
}) {
  const [manual, setManual] = useState<string>();
  const items = [...new Map(snapshot.cases.map((item) => [item.id, item])).values()];
  const selected = items.find(({ id }) => id === manual) ?? items.at(-1);
  const list = useRef<HTMLFieldSetElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (manual === undefined && selectedId !== undefined && list.current !== null) {
      list.current.scrollTop = list.current.scrollHeight;
    }
  }, [manual, selectedId]);
  return (
    <section className={styles.stage} aria-label={importing ? C.import : C.author}>
      <header className={styles.stageHeader}>
        <h2 className="grow">{importing ? C.import : C.author}</h2>
        {manual !== undefined && (
          <Button size="sm" onClick={() => setManual(undefined)}>
            {importing ? C.followImport : C.followAuthor}
          </Button>
        )}
      </header>
      <div className={styles.author}>
        {selected === undefined ? (
          <p className={`hint ${styles.authorEmpty}`}>{C.noCases}</p>
        ) : (
          <>
            <section className={styles.panel} aria-label={C.cases}>
              <header className={styles.panelHead}>
                <h2>{C.cases}</h2>
                <small>{items.length}</small>
              </header>
              <fieldset ref={list} className={styles.authorList} aria-label={C.cases}>
                {items.map((item) => (
                  <button
                    type="button"
                    className={styles.caseRow}
                    key={item.id}
                    aria-pressed={selected.id === item.id}
                    onClick={() => setManual(item.id)}
                  >
                    <span className={styles.caseTitle}>
                      <span className={`mono ${styles.caseNumber}`}>{item.number}</span>
                      <strong className="ellipsis">{item.title}</strong>
                    </span>
                  </button>
                ))}
              </fieldset>
            </section>
            <div className={styles.panel}>
              <CaseDefinition
                key={selected.id}
                taskId={task.id}
                item={selected}
                attachments={task.attachments}
                revisions={revisionsFor(snapshot.events, selected.id)}
              />
            </div>
          </>
        )}
        <PhaseActivity task={task} nodeId={nodeId} expandActions />
      </div>
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
  usePlacedTab(active && query.data !== undefined ? (handoff?.tabId ?? null) : null, handoffArea);
  const scope = task.functionalTest;
  if (scope === undefined) return null;
  if (query.data === undefined) {
    return query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <p className="hint">{COMMON_COPY.loading}</p>
    );
  }
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
      {query.isRefetchError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      <div className={styles.toolbar}>
        <nav className={styles.phaseBar} aria-label={C.phases}>
          {phases.map((item) => (
            <Button
              key={item}
              size="sm"
              variant="ghost"
              icon={phaseIcon[item]}
              aria-current={automatic === item ? 'step' : undefined}
              aria-pressed={phase === item}
              data-progress={
                phases.indexOf(item) < phases.indexOf(automatic) ? 'done' : automatic === item ? 'current' : 'pending'
              }
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
      <details className={styles.scope}>
        <summary>
          {C.scope} <code className={styles.target}>{scope.target}</code>
        </summary>
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
        <section className={`col ${styles.panel} ${styles.phaseActivity}`}>
          <BrowserCaseHandoffPane taskId={task.id} handoff={handoff} />
          {window.aw !== undefined && <div ref={handoffArea} className={styles.handoffSurface} />}
        </section>
      )}
      {(phase === N.Author || phase === N.Import) && (
        <AuthorCases task={task} snapshot={snapshot} importing={phase === N.Import} nodeId={phaseNodeId} />
      )}
      {phase === N.Environment && (
        <div className={styles.phaseLayout}>
          <TestEnvironment environment={environment} />
          <PhaseActivity task={task} nodeId={phaseNodeId} />
        </div>
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
      {phase === N.Report && (
        <div className={styles.phaseLayout}>
          <TestReport
            key={run?.id}
            task={task}
            events={snapshot.events}
            reports={snapshot.reports.filter(({ runId }) => runId === run?.id)}
            onEvidence={(caseId, executionId) => {
              setEvidence({ caseId, executionId });
              setExecutionView((epoch) => epoch + 1);
              setPickedPhase(N.Execute);
            }}
          />
          <PhaseActivity task={task} nodeId={phaseNodeId} />
        </div>
      )}
    </div>
  );
}
