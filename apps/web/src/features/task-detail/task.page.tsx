import {
  DeliveryStatus,
  EDITABLE_NODE_STATUSES,
  InboxKind,
  NodeKind,
  type TaskDetailDTO,
  TaskStatus,
  UiMode,
  WorkflowDeliverable,
  WorkflowPlanning,
  WorktreeStatus,
} from '@aw/shared';
import * as RadixTabs from '@radix-ui/react-tabs';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ProgressCanvas } from '../../canvas/progress-canvas.tsx';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ARTIFACT_COPY } from '../../copy/artifacts.ts';
import { PREVIEW_PANE_COPY } from '../../copy/browser.ts';
import { BROWSER_CASE_COPY } from '../../copy/browser-cases.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { CANVAS_COPY } from '../../copy/plan-editor.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { BROWSER_TEST_COPY, TASK_COPY as C } from '../../copy/tasks.ts';
import { ArtifactWorkbench } from '../artifacts/artifact-workbench.tsx';
import { TaskBrowserCase } from '../browser-cases/task-browser-case.tsx';
import { InboxCard } from '../inbox/inbox-card.tsx';
import { FrontendRoundHistory, FrontendWorkbench } from '../preview/frontend-workbench.tsx';
import { BrowserTestPane, PreviewPane } from '../preview/preview-pane.tsx';
import { projectQuery } from '../projects/projects.queries.ts';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { failedNodeKeyOf } from '../tasks/failure-text.ts';
import { taskQuery } from '../tasks/tasks.queries.ts';
import { DeliveryDialogButton } from './delivery-actions.tsx';
import { FailurePanel } from './failure-panel.tsx';
import { NodeDetailPane, NodeDrawer, type NodeTab } from './node-drawer.tsx';
import { PausedBanner } from './paused-banner.tsx';
import { PlanReview } from './plan-review.tsx';
import { PlanningProgress } from './planning-progress.tsx';
import { RemoteDeliveryStatus } from './remote-delivery-status.tsx';
import { DeliveryOutcome, ResultCard } from './result-card.tsx';
import { ReviewComments } from './review-comments.tsx';
import { stepsOfNodes } from './steps.ts';
import { TaskCodeChanges } from './task-code-changes.tsx';
import { TaskCodeReviewWorkbench } from './task-code-review.tsx';
import { TaskHeader } from './task-header.tsx';
import styles from './task-page.module.css';
import { TaskPlanEditor } from './task-plan-editor.tsx';
import { TaskReadFollow } from './task-read-follow.tsx';
import { TaskSide } from './task-side.tsx';

const route = getRouteApi(ROUTE_IDS.task);
/** The task's steps are all behind it: the canvas's end pill shows it. */
const FINISHED_TASK: readonly TaskStatus[] = [TaskStatus.Review, TaskStatus.Merging, TaskStatus.Completed];
/** Its preview tabs close and its worktree may be gone (29 §5.3). */
const ENDED_TASK: readonly TaskStatus[] = [TaskStatus.Completed, TaskStatus.Cancelled];

type Selection = {
  selected: string | undefined;
  /** Opens the step's details drawer, on `tab` when given. */
  open: (id: string, tab?: NodeTab) => void;
};
type MainProps = { task: TaskDetailDTO; selection: Selection; pro: boolean };

/** Canvas of the task's steps with the side panel. */
function StepsView({ task, selection, pro }: MainProps) {
  return (
    <div className={styles.layout}>
      <ProgressCanvas
        steps={stepsOfNodes(task)}
        label={CANVAS_COPY.progressLabel}
        finished={FINISHED_TASK.includes(task.status)}
        selectedId={selection.selected}
        onSelect={selection.open}
        onOpen={selection.open}
      />
      <TaskSide task={task} selectedId={selection.selected} onOpen={selection.open} pro={pro} />
    </div>
  );
}

/**
 * Running, paused (M5-02) and failed: the steps under the adjustment banner or failure panel, or the plan editor with
 * started steps locked. The canvas keeps its place in the tree across these states, so pausing or resuming does not
 * remount it: a remount lost the user's view, and in CI left the new canvas with nodes it never measured (hidden).
 */
function StepsMain(props: MainProps) {
  const { task } = props;
  const [adjusting, setAdjusting] = useState(false);
  const paused = task.status === TaskStatus.Paused;
  const failed = task.status === TaskStatus.Failed;
  if (paused && adjusting && task.plan !== null) {
    const base = task.draftPlan ?? task.plan;
    const lock = {
      base: task.plan.graph,
      locked: new Set(task.nodes.filter((n) => !EDITABLE_NODE_STATUSES.includes(n.status)).map((n) => n.key)),
    };
    return (
      <div className="col">
        <p className="hint">{C.adjustHint}</p>
        <TaskPlanEditor
          task={task}
          base={base}
          lock={lock}
          statuses={new Map(task.nodes.map((n) => [n.key, n.status]))}
          onDone={() => setAdjusting(false)}
        />
      </div>
    );
  }
  return (
    <div className="col">
      {paused && <PausedBanner task={task} pro={props.pro} onAdjust={() => setAdjusting(true)} />}
      {failed && <FailurePanel task={task} onOpenStep={props.selection.open} />}
      {(!failed || task.nodes.length > 0) && <StepsView {...props} />}
    </div>
  );
}

function SavePlanTemplate({ task }: { task: TaskDetailDTO }) {
  return (
    task.status === TaskStatus.Completed &&
    task.plan !== null &&
    task.workflow.planning === WorkflowPlanning.Ai && (
      <Link className="btn secondary" to={ROUTES.workflowNew} search={{ task: task.id, version: task.plan.version }}>
        {C.savePlanTemplate}
      </Link>
    )
  );
}

/** The main area follows the task's state (14 §3.3). */
function TaskMain({
  task,
  selection,
  pro,
  deliveryInToolbar = false,
  canvasActive,
}: MainProps & { deliveryInToolbar?: boolean; canvasActive?: boolean }) {
  const active = canvasActive !== false;
  const props = { task, selection, pro };
  switch (task.status) {
    case TaskStatus.Draft:
    case TaskStatus.Preparing:
    case TaskStatus.Planning:
      return (
        <div className={styles.layout}>
          <PlanningProgress task={task} />
          <TaskSide task={task} selectedId={undefined} onOpen={selection.open} />
        </div>
      );
    case TaskStatus.PlanReview:
      return <PlanReview task={task} pro={pro} />;
    case TaskStatus.Running:
    case TaskStatus.Paused:
    case TaskStatus.Failed:
      return <StepsMain {...props} />;
    case TaskStatus.Review:
      return (
        <div className="col">
          {task.nodes.length > 0 && (
            <details className={styles.canvasFold} open>
              <summary className="hint">{C.canvasToggle}</summary>
              <StepsView {...props} />
            </details>
          )}
          <a href="#task-acceptance-result">{C.viewAcceptanceResult}</a>
          {active && (
            <div id="task-acceptance-result" tabIndex={-1}>
              <ResultCard task={task} showDelivery={!deliveryInToolbar} />
            </div>
          )}
        </div>
      );
    case TaskStatus.Merging:
    case TaskStatus.Completed:
    case TaskStatus.Cancelled:
      return (
        <div className="col">
          {canvasActive !== undefined && task.nodes.length > 0 && <StepsView {...props} />}
          {active && task.result !== null ? <ResultCard task={task} /> : null}
          {active && <SavePlanTemplate task={task} />}
          {canvasActive === undefined && task.nodes.length > 0 && (
            <details className={styles.canvasFold} open={task.result === null}>
              <summary className="hint">{C.canvasToggle}</summary>
              <StepsView {...props} />
            </details>
          )}
        </div>
      );
  }
}

function hasVisibleChecklist(task: TaskDetailDTO): boolean {
  if (task.status === TaskStatus.Review) return true;
  if (task.status === TaskStatus.Merging || ENDED_TASK.includes(task.status)) return task.result !== null;
  if (task.status !== TaskStatus.Failed || task.failure === null) return false;
  const failedKey = failedNodeKeyOf(task.failure);
  return task.nodes.some((node) => node.key === failedKey && node.kind === NodeKind.Verify);
}

export function TaskPage() {
  const { taskId } = route.useParams();
  const [expandedTask, setExpandedTask] = useState<string>();
  const expanded = expandedTask === taskId;
  const [readFollowTask, setReadFollowTask] = useState<string>();
  const [siteTask, setSiteTask] = useState<string>();
  const [visitedCanvas, setVisitedCanvas] = useState<string>();
  const { node, details, requirement, artifactVersion } = route.useSearch();
  const navigate = route.useNavigate();
  const task = useQuery({
    ...taskQuery(taskId),
    refetchOnWindowFocus: (query) =>
      query.state.data?.lastDelivery?.status === DeliveryStatus.Conflict &&
      query.state.data.artifact?.versions.at(-1)?.repository !== undefined,
  });
  // The pro view: pro mode, or「显示详细信息」on this task in simple mode (D19).
  const isPro = useSettings()['ui.mode'] === UiMode.Pro;
  const pro = isPro || details === true;
  const selection: Selection = {
    selected: node,
    open: (id, tab) =>
      void navigate({
        search: (prev) => ({
          ...prev,
          view: prev.view ?? (canvas ? 'progress' : 'result'),
          node: id,
          open: true,
          tab,
        }),
      }),
  };
  const { open, tab, view } = route.useSearch();
  const nodeId = open === true ? node : undefined;
  const closeNode = () => void navigate({ search: (prev) => ({ ...prev, open: false }), replace: true });
  const project = useQuery({ ...projectQuery(task.data?.project.id ?? ''), enabled: task.data !== undefined });
  if (task.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => void task.refetch()} />;
  const frontend = task.data.frontend;
  const artifact = task.data.artifact;
  const repositoryDocument = artifact?.versions.at(-1)?.repository !== undefined;
  const codeReview = task.data.codeReview;
  const reviewOpen =
    codeReview !== undefined && task.data.status !== TaskStatus.Draft && task.data.status !== TaskStatus.PlanReview;
  const artifactOpen =
    artifact !== undefined && task.data.status !== TaskStatus.Draft && task.data.status !== TaskStatus.PlanReview;
  const nodeDetails =
    nodeId === undefined
      ? undefined
      : {
          title: task.data.nodes.find((item) => item.id === nodeId)?.title ?? C.viewNode,
          content: <NodeDetailPane taskId={taskId} nodeId={nodeId} tab={tab} pro={pro} />,
          onClose: closeNode,
        };
  const workbench =
    frontend !== undefined && !ENDED_TASK.includes(task.data.status) && task.data.status !== TaskStatus.Merging;
  const record = (
    <div className={styles.frontendProgress}>
      {task.data.status === TaskStatus.Review || task.data.status === TaskStatus.Completed ? (
        <StepsView task={task.data} selection={selection} pro={pro} />
      ) : (
        <TaskMain task={task.data} selection={selection} pro={pro} />
      )}
    </div>
  );
  const browserTest = task.data.browserTest !== undefined;
  const configuredPreview =
    project.data?.preview != null &&
    task.data.git.worktreeStatus === WorktreeStatus.Ready &&
    !ENDED_TASK.includes(task.data.status);
  const code =
    !artifactOpen &&
    !reviewOpen &&
    !workbench &&
    !browserTest &&
    task.data.workflow.deliverable === WorkflowDeliverable.CodeChanges &&
    (task.data.git.worktreeStatus === WorktreeStatus.Ready || task.data.status === TaskStatus.Completed);
  const needsPlan = [TaskStatus.Draft, TaskStatus.Preparing, TaskStatus.Planning, TaskStatus.PlanReview].some(
    (status) => status === task.data.status,
  );
  const hasViews =
    ((!needsPlan && (workbench || artifactOpen || code)) || browserTest || configuredPreview) && !reviewOpen;
  const canvas =
    hasViews &&
    (view === 'progress' ||
      (view === undefined &&
        ((needsPlan && !workbench && !artifactOpen && !browserTest) ||
          node !== undefined ||
          requirement !== undefined ||
          task.data.status === TaskStatus.Failed ||
          task.data.status === TaskStatus.Paused)));
  if (canvas && visitedCanvas !== taskId) setVisitedCanvas(taskId);
  const siteSelected = view === 'preview' || (canvas && siteTask === taskId);
  const watchingTest = browserTest && !canvas && hasViews;
  const resultLabel = artifactOpen
    ? R.document
    : browserTest
      ? BROWSER_TEST_COPY.browser
      : code && !needsPlan
        ? R.code
        : PREVIEW_PANE_COPY.tabPreview;
  const resultPanel = (reading = false) =>
    needsPlan && !hasViews && !workbench && !artifactOpen && !reviewOpen ? (
      <TaskMain task={task.data} selection={selection} pro={pro} />
    ) : artifactOpen ? (
      <ArtifactWorkbench
        key={task.data.id}
        task={task.data}
        artifact={artifact}
        selectedVersion={artifactVersion}
        onSelectVersion={(id) => void navigate({ search: (prev) => ({ ...prev, artifactVersion: id }), replace: true })}
        nodeDetails={canvas ? undefined : nodeDetails}
        onOpenNode={selection.open}
        record={record}
        {...(task.data.workflow.deliverable === WorkflowDeliverable.CodeChanges
          ? {
              renderDelivery: (version, disabled) => (
                <DeliveryDialogButton
                  key={version.id}
                  task={task.data}
                  label={ARTIFACT_COPY.deliver}
                  artifactVersionId={version.id}
                  disabled={disabled}
                />
              ),
            }
          : {})}
      />
    ) : reviewOpen ? (
      <TaskCodeReviewWorkbench
        key={taskId}
        task={task.data}
        review={codeReview}
        pro={isPro}
        record={record}
        nodeDetails={canvas ? undefined : nodeDetails}
      />
    ) : workbench ? (
      <FrontendWorkbench
        key={task.data.id}
        task={task.data}
        pro={pro}
        active={!canvas && !reading}
        hasConfiguredPreview={project.data?.preview != null}
        onOpenNode={selection.open}
        nodeDetails={canvas ? undefined : nodeDetails}
        delivery={
          task.data.status === TaskStatus.Review && frontend.verified && <DeliveryDialogButton task={task.data} />
        }
        progress={
          <div className={styles.frontendProgress}>
            {task.data.status === TaskStatus.Review && !frontend.verified ? (
              <StepsView task={task.data} selection={selection} pro={pro} />
            ) : (
              <TaskMain task={task.data} selection={selection} pro={pro} deliveryInToolbar />
            )}
          </div>
        }
      />
    ) : browserTest ? (
      <BrowserTestPane task={task.data} active={!canvas && !reading} />
    ) : code && !needsPlan ? (
      <>
        {!canvas &&
          task.data.openInbox
            .filter((item) => item.kind !== InboxKind.Failure)
            .map((item) => <InboxCard key={item.id} item={item} showTask={false} />)}
        {!canvas && task.data.status === TaskStatus.Failed && (
          <FailurePanel task={task.data} onOpenStep={selection.open} />
        )}
        {configuredPreview && (
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, view: view === 'preview' ? 'result' : 'preview' }) })
            }
          >
            {view === 'preview' ? R.viewCode : R.openWeb}
          </button>
        )}
        {configuredPreview && siteSelected ? (
          <PreviewPane task={task.data} active={!canvas && !reading} pro={pro} />
        ) : (
          <TaskCodeChanges key={taskId} task={task.data} active={!canvas && !reading} />
        )}
        {!canvas && task.data.result !== null && (
          <>
            <ResultCard task={task.data} />
            <SavePlanTemplate task={task.data} />
          </>
        )}
      </>
    ) : configuredPreview ? (
      <PreviewPane task={task.data} active={!canvas && !reading} pro={pro} />
    ) : (
      <TaskMain task={task.data} selection={selection} pro={pro} />
    );
  const resultView =
    (code ||
      workbench ||
      artifactOpen ||
      (needsPlan && task.data.workflow.deliverable === WorkflowDeliverable.CodeChanges)) &&
    !browserTest ? (
      <TaskReadFollow
        key={taskId}
        task={task.data}
        repo={project.data?.repoPath ?? ''}
        active={!canvas}
        following={readFollowTask === taskId}
        onFollow={(on) => setReadFollowTask(on ? taskId : undefined)}
      >
        {resultPanel}
      </TaskReadFollow>
    ) : (
      resultPanel()
    );
  return (
    <div
      className={`page wide ${hasViews ? styles.resultPage : ''} ${watchingTest ? styles.testViewing : ''}`}
      data-result-expanded={(hasViews && expanded) || undefined}
      data-testid="task-page"
    >
      <TaskHeader
        task={task.data}
        pro={pro}
        details={isPro ? undefined : details === true}
        onDetailsChange={(on) => void navigate({ search: (prev) => ({ ...prev, details: on }), replace: true })}
      />
      {task.data.browserCaseHandoff !== undefined && !watchingTest && (
        <div className="row">
          <strong>{BROWSER_CASE_COPY.handoff.heading}</strong>
          <Button size="sm" onClick={() => void navigate({ search: (prev) => ({ ...prev, view: 'preview' }) })}>
            {BROWSER_CASE_COPY.handoff.open}
          </Button>
        </div>
      )}
      {task.data.browserTest !== undefined && (
        <div className="col">
          <div className="row">
            <TaskBrowserCase key={task.data.id} task={task.data} />
          </div>
          {!watchingTest && (
            <p className="hint">
              {BROWSER_TEST_COPY.target} · {task.data.browserTest.target}
            </p>
          )}
          {!watchingTest && (
            <p className="hint">
              {BROWSER_TEST_COPY.writes} ·{' '}
              {task.data.browserTest.writes.map(({ method, path }) => `${method} ${path}`).join('、') ||
                BROWSER_TEST_COPY.noWrites}
            </p>
          )}
        </div>
      )}
      {requirement !== undefined && !hasVisibleChecklist(task.data) && <RequirementsSection task={task.data} />}
      {repositoryDocument && <DeliveryOutcome task={task.data} />}
      {repositoryDocument && task.data.status === TaskStatus.Completed && task.data.pullRequest !== null && (
        <RemoteDeliveryStatus task={task.data} />
      )}
      {hasViews ? (
        <RadixTabs.Root
          className={styles.resultTabs}
          value={canvas ? 'progress' : 'result'}
          onValueChange={(value) => {
            if (value === 'progress') setSiteTask(siteSelected ? taskId : undefined);
            void navigate({
              search: (prev) => ({
                ...prev,
                view: value === 'progress' ? 'progress' : siteTask === taskId ? 'preview' : 'result',
                open: false,
              }),
              replace: true,
            });
          }}
        >
          <div className={styles.viewBar}>
            <RadixTabs.List className="tabs" aria-label={R.views}>
              <RadixTabs.Trigger className="tab" value="result">
                {resultLabel}
              </RadixTabs.Trigger>
              <RadixTabs.Trigger className="tab" value="progress">
                {R.canvas}
              </RadixTabs.Trigger>
            </RadixTabs.List>
            <Button
              size="sm"
              variant="ghost"
              icon="expand"
              aria-pressed={expanded}
              onClick={() => setExpandedTask(expanded ? undefined : taskId)}
            >
              {expanded ? R.restore : R.expand}
            </Button>
          </div>
          <div className={styles.viewArea}>
            <RadixTabs.Content
              value="result"
              forceMount
              inert={canvas}
              aria-hidden={canvas}
              className={styles.viewPanel}
            >
              {resultView}
            </RadixTabs.Content>
            <RadixTabs.Content
              value="progress"
              forceMount
              inert={!canvas}
              aria-hidden={!canvas}
              className={styles.viewPanel}
            >
              {(canvas || visitedCanvas === taskId) && (
                <TaskMain canvasActive={canvas} task={task.data} selection={selection} pro={pro} />
              )}
            </RadixTabs.Content>
          </div>
        </RadixTabs.Root>
      ) : (
        resultView
      )}
      {repositoryDocument && task.data.status === TaskStatus.Completed && task.data.pullRequest !== null && (
        <ReviewComments task={task.data} />
      )}
      {!workbench && frontend !== undefined && <FrontendRoundHistory task={task.data} onOpen={selection.open} />}
      {(canvas || (!workbench && !artifactOpen && !reviewOpen)) && (
        <NodeDrawer taskId={taskId} nodeId={nodeId} tab={tab} pro={pro} onClose={closeNode} />
      )}
    </div>
  );
}
