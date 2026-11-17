import {
  DeliveryStatus,
  EDITABLE_NODE_STATUSES,
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
import { BROWSER_TEST_COPY, TASK_COPY as C } from '../../copy/tasks.ts';
import { ArtifactWorkbench } from '../artifacts/artifact-workbench.tsx';
import { TaskBrowserCase } from '../browser-cases/task-browser-case.tsx';
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
import { TaskCodeReviewWorkbench } from './task-code-review.tsx';
import { TaskHeader } from './task-header.tsx';
import styles from './task-page.module.css';
import { TaskPlanEditor } from './task-plan-editor.tsx';
import { TaskSide } from './task-side.tsx';

const route = getRouteApi(ROUTE_IDS.task);
/** The task's steps are all behind it: the canvas's end pill shows it. */
const FINISHED_TASK: readonly TaskStatus[] = [TaskStatus.Review, TaskStatus.Merging, TaskStatus.Completed];
/** Its preview tabs close and its worktree may be gone (29 §5.3). */
const ENDED_TASK: readonly TaskStatus[] = [TaskStatus.Completed, TaskStatus.Cancelled];

type Selection = {
  selected: string | undefined;
  select: (id: string) => void;
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
        onSelect={selection.select}
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

/** The main area follows the task's state (14 §3.3). */
function TaskMain({ task, selection, pro, deliveryInToolbar = false }: MainProps & { deliveryInToolbar?: boolean }) {
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
          <div id="task-acceptance-result" tabIndex={-1}>
            <ResultCard task={task} showDelivery={!deliveryInToolbar} />
          </div>
        </div>
      );
    case TaskStatus.Merging:
    case TaskStatus.Completed:
    case TaskStatus.Cancelled:
      return (
        <div className="col">
          {task.result !== null ? <ResultCard task={task} /> : null}
          {task.status === TaskStatus.Completed &&
            task.plan !== null &&
            task.workflow.planning === WorkflowPlanning.Ai && (
              <Link
                className="btn secondary"
                to={ROUTES.workflowNew}
                search={{ task: task.id, version: task.plan.version }}
              >
                {C.savePlanTemplate}
              </Link>
            )}
          {task.nodes.length > 0 && (
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
    select: (id) => void navigate({ search: (prev) => ({ ...prev, node: id }), replace: true }),
    open: (id, tab) => void navigate({ search: (prev) => ({ ...prev, node: id, open: true, tab }) }),
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
  return (
    <div className="page wide" data-testid="task-page">
      <TaskHeader
        task={task.data}
        pro={pro}
        details={isPro ? undefined : details === true}
        onDetailsChange={(on) => void navigate({ search: (prev) => ({ ...prev, details: on }), replace: true })}
      />
      {task.data.browserCaseHandoff !== undefined && view !== 'preview' && (
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
          <p className="hint">
            {BROWSER_TEST_COPY.target} · {task.data.browserTest.target}
          </p>
          <p className="hint">
            {BROWSER_TEST_COPY.writes} ·{' '}
            {task.data.browserTest.writes.map(({ method, path }) => `${method} ${path}`).join('、') ||
              BROWSER_TEST_COPY.noWrites}
          </p>
        </div>
      )}
      {requirement !== undefined && !hasVisibleChecklist(task.data) && <RequirementsSection task={task.data} />}
      {repositoryDocument && <DeliveryOutcome task={task.data} />}
      {repositoryDocument && task.data.status === TaskStatus.Completed && task.data.pullRequest !== null && (
        <RemoteDeliveryStatus task={task.data} />
      )}
      {artifactOpen ? (
        <ArtifactWorkbench
          key={task.data.id}
          task={task.data}
          artifact={artifact}
          selectedVersion={artifactVersion}
          onSelectVersion={(id) =>
            void navigate({ search: (prev) => ({ ...prev, artifactVersion: id }), replace: true })
          }
          nodeDetails={nodeDetails}
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
          nodeDetails={nodeDetails}
        />
      ) : workbench ? (
        <FrontendWorkbench
          key={task.data.id}
          task={task.data}
          pro={pro}
          hasConfiguredPreview={project.data?.preview != null}
          onOpenNode={selection.open}
          nodeDetails={nodeDetails}
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
      ) : task.data.browserTest !== undefined ||
        (project.data?.preview != null &&
          task.data.git.worktreeStatus === WorktreeStatus.Ready &&
          !ENDED_TASK.includes(task.data.status)) ? (
        <RadixTabs.Root
          value={view ?? 'progress'}
          onValueChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, view: next === 'preview' ? 'preview' : undefined }),
              replace: true,
            })
          }
        >
          <RadixTabs.List className="tabs">
            <RadixTabs.Trigger value="progress" className="tab">
              {PREVIEW_PANE_COPY.tabProgress}
            </RadixTabs.Trigger>
            <RadixTabs.Trigger value="preview" className="tab">
              {task.data.browserTest === undefined ? PREVIEW_PANE_COPY.tabPreview : BROWSER_TEST_COPY.browser}
            </RadixTabs.Trigger>
          </RadixTabs.List>
          <RadixTabs.Content value="progress" className="tab-panel">
            <TaskMain task={task.data} selection={selection} pro={pro} />
          </RadixTabs.Content>
          {/* Kept mounted on the progress tab: the user's preview tab stays open, only off the window. */}
          <RadixTabs.Content value="preview" className="tab-panel" forceMount hidden={view !== 'preview'}>
            {task.data.browserTest === undefined ? (
              <PreviewPane task={task.data} active={view === 'preview'} pro={pro} />
            ) : (
              <BrowserTestPane task={task.data} active={view === 'preview'} />
            )}
          </RadixTabs.Content>
        </RadixTabs.Root>
      ) : (
        <TaskMain task={task.data} selection={selection} pro={pro} />
      )}
      {repositoryDocument && task.data.status === TaskStatus.Completed && task.data.pullRequest !== null && (
        <ReviewComments task={task.data} />
      )}
      {!workbench && frontend !== undefined && <FrontendRoundHistory task={task.data} onOpen={selection.open} />}
      {!workbench && !artifactOpen && !reviewOpen && (
        <NodeDrawer taskId={taskId} nodeId={nodeId} tab={tab} pro={pro} onClose={closeNode} />
      )}
    </div>
  );
}
