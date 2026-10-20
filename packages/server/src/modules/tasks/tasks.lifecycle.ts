import { randomUUID } from 'node:crypto';
import { PromptName, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  type CreateTaskRequest,
  ErrorCode,
  type ErrorInfo,
  FailureAction,
  InboxKind,
  InboxStatus,
  NodeStatus,
  PLAN_PROBLEM_HINT,
  type PlanDTO,
  PlanSource,
  type SubmitPlanInput,
  TASK_KEY_PREFIX,
  TASK_TITLE_MAX_CHARS,
  TaskEvent,
  TaskFailedPhase,
  TaskStatus,
  type WorkflowDTO,
  WorkflowPlanning,
  WorktreeStatus,
} from '@aw/shared';
import { branchExists } from '../git/index.ts';
import { planGraphFromSubmission, validateSubmission } from '../plans/index.ts';
import type { Worktree } from '../worktrees/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';

/** Where a retry continues for each failed phase (09 §2). */
const RETRY_TARGET = {
  [TaskFailedPhase.Preparing]: TaskStatus.Preparing,
  [TaskFailedPhase.Planning]: TaskStatus.Planning,
  [TaskFailedPhase.Running]: TaskStatus.Running,
  [TaskFailedPhase.Merging]: TaskStatus.Review,
} as const satisfies Record<TaskFailedPhase, TaskStatus>;

/**
 * The task lifecycle (09 §2): create → prepare the worktree → plan (AI or template) → run nodes → review; plus
 * cancelling and retrying. Node dispatch and the derived task events belong to the scheduler.
 */
export function createTaskLifecycle(deps: TasksServiceDeps, state: TaskState) {
  const { unit, clock, log, settings, prompts, projects, workflows, roles, worktrees, plans, nodes, attempts, inbox } =
    deps;
  const { repo, get, move, fail } = state;

  /** Work started by a call that does not wait for it; an unexpected failure is logged with the task. */
  const inBackground = (taskId: string, work: () => Promise<void>): void => {
    work().catch((err: unknown) => log.error({ err, taskId }, 'task background work failed'));
  };

  /** Confirms a plan version and creates its nodes; the scheduler dispatches them once this commits. */
  function confirmAndMaterialize(task: Task, plan: PlanDTO, workflow: WorkflowDTO): void {
    plans.confirm(plan.id);
    repo.update(task.id, { currentPlanId: plan.id, updatedAt: clock.now() });
    nodes.materialize({
      taskId: task.id,
      planId: plan.id,
      graph: plan.graph,
      checkCommand: projects.getRecord(task.projectId).checkCommand,
      defaultAcceptance: workflow.definition.defaultAcceptance,
      acceptEachNode: task.checkpoints.accept_each_node,
    });
  }

  function requestPlanReview(task: Task, plan: PlanDTO): void {
    inbox.create({
      kind: InboxKind.Plan,
      taskId: task.id,
      nodeId: null,
      attemptId: null,
      title: task.title,
      payload: { planId: plan.id, version: plan.version },
    });
  }

  /** The worktree exists: plan with AI, or use the workflow's template (09 §2 `workspace_ready`). */
  function workspaceReady(task: Task, worktree: Worktree): void {
    const workflow = workflows.get(task.workflowId);
    const git = { baseCommit: worktree.baseCommit, branch: worktree.branch };
    if (workflow.planning === WorkflowPlanning.Ai) {
      // The scheduler starts the planning attempt once this commits.
      move(task, TaskEvent.WorkspaceReady, TaskStatus.Planning, git);
      return;
    }
    const { template } = workflow.definition;
    if (template === undefined) {
      throw new AppError(ErrorCode.WorkflowDefinitionInvalid, `Fixed workflow ${workflow.key} has no template`, {
        problems: [{ code: 'MISSING_TEMPLATE', message: 'A fixed workflow needs a template' }],
      });
    }
    const confirmFirst = task.checkpoints.confirm_plan;
    unit.transact(() => {
      const ready = move(
        task,
        TaskEvent.WorkspaceReady,
        confirmFirst ? TaskStatus.PlanReview : TaskStatus.Running,
        git,
      );
      const plan = plans.createDraft({
        taskId: task.id,
        source: PlanSource.Template,
        graph: template,
        summary: null,
        assumptions: [],
        feedback: null,
        createdByAttemptId: null,
      });
      if (confirmFirst) requestPlanReview(ready, plan);
      else confirmAndMaterialize(ready, plan, workflow);
    });
  }

  /** `preparing`: branch and worktree (09 §6), then the next phase. Also resumes a preparation cut short. */
  async function prepare(taskId: string): Promise<void> {
    const task = get(taskId);
    const project = projects.getRecord(task.projectId);
    let worktree: Worktree;
    try {
      const existing = worktrees.findByTask(taskId);
      if (existing !== undefined && existing.status !== WorktreeStatus.Ready)
        await worktrees.discard(existing, project.repoPath);
      worktree =
        existing?.status === WorktreeStatus.Ready
          ? existing
          : await worktrees.create({
              taskId,
              taskKey: task.key,
              title: task.title,
              projectId: project.id,
              projectSlug: project.slug,
              repoPath: project.repoPath,
              baseBranch: task.baseBranch,
            });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      const current = get(taskId);
      if (current.status === TaskStatus.Preparing) fail(current, TaskFailedPhase.Preparing, err.toInfo());
      return;
    }
    const current = get(taskId);
    if (current.status === TaskStatus.Preparing) {
      workspaceReady(current, worktree);
      return;
    }
    // Cancelled while the worktree was being created: nothing will use it.
    if (current.status === TaskStatus.Cancelled) {
      await worktrees.remove(worktree, { repoPath: project.repoPath, deleteBranch: true });
    }
  }

  function start(taskId: string): void {
    move(get(taskId), TaskEvent.Start, undefined, { startedAt: clock.now() });
    inBackground(taskId, () => prepare(taskId));
  }

  /** The planner's feedback for the next draft: the re-planning request on the latest draft, if any. */
  function pendingReplanFeedback(taskId: string): string | null {
    const [latest] = inbox.list({ taskId, kind: InboxKind.Plan }, InboxStatus.Resolved);
    if (latest?.kind !== InboxKind.Plan || latest.response === null || !('replanFeedback' in latest.response)) {
      return null;
    }
    const [newest] = plans.list(taskId);
    return newest?.version === latest.payload.version ? latest.response.replanFeedback : null;
  }

  // A planning attempt that ends without a plan fails the planning phase; an interrupted one is restarted by the
  // scheduler once the runtime is back.
  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.kind !== AttemptKind.Plan || attempt.taskId === null) return;
    if (attempt.status === AttemptStatus.Succeeded || attempt.status === AttemptStatus.Interrupted) return;
    const task = get(attempt.taskId);
    if (task.status !== TaskStatus.Planning) return;
    const error: ErrorInfo = attempt.error ?? {
      code: ErrorCode.AttemptNoResult,
      message: 'The planning session was stopped',
    };
    fail(task, TaskFailedPhase.Planning, error);
  });

  return {
    prepare,

    async create(input: CreateTaskRequest): Promise<string> {
      const project = projects.getRecord(input.projectId);
      const workflow = workflows.get(input.workflowId);
      const baseBranch = input.baseBranch ?? project.defaultBranch;
      if (!(await branchExists(project.repoPath, baseBranch))) {
        throw new AppError(ErrorCode.GitBaseBranchNotFound, 'Base branch does not exist', { branch: baseBranch });
      }
      // Request > workflow definition > setting (11 §5.1); fixed for the task's lifetime.
      const checkpoints = {
        confirm_plan: input.checkpoints?.confirm_plan ?? workflow.definition.checkpoints.confirm_plan,
        accept_each_node: input.checkpoints?.accept_each_node ?? workflow.definition.checkpoints.accept_each_node,
        ask_on_uncertainty: input.checkpoints?.ask_on_uncertainty ?? settings.get('ai.askOnUncertainty'),
      };
      const id = randomUUID();
      const now = clock.now();
      repo.insert(
        {
          id,
          projectId: project.id,
          workflowId: workflow.id,
          title: input.title ?? firstLine(input.requirement).slice(0, TASK_TITLE_MAX_CHARS),
          requirement: input.requirement,
          status: TaskStatus.Draft,
          baseBranch,
          checkpoints,
          createdAt: now,
          updatedAt: now,
        },
        TASK_KEY_PREFIX,
      );
      log.info({ taskId: id, workflow: workflow.key }, 'task created');
      state.publish(id);
      if (input.start !== false) start(id);
      return id;
    },

    start,

    /** Starts the planning attempt of a task in `planning` (called by the scheduler). */
    startPlanning(taskId: string): void {
      const task = get(taskId);
      const workflow = workflows.get(task.workflowId);
      const { plannerRole } = workflow.definition;
      if (plannerRole === undefined) {
        throw new AppError(ErrorCode.WorkflowDefinitionInvalid, `Workflow ${workflow.key} has no planner role`, {
          problems: [{ code: 'MISSING_PLANNER', message: 'An AI-planned workflow needs a planner role' }],
        });
      }
      const planner = roles.getByKey(plannerRole);
      const { directory } = state.runContext(task);
      const start = attempts.start({
        kind: AttemptKind.Plan,
        taskId,
        nodeId: null,
        roleId: planner.id,
        agent: planner.baseAgent,
        directory,
        title: `${task.key} · ${task.title}`,
        model: planner.model ?? settings.get('ai.defaultModel'),
        system: planner.prompt,
        prompt: renderTemplate(prompts[PromptName.StartPlan], {
          taskKey: task.key,
          taskTitle: task.title,
          workflowName: workflow.name,
          requirement: task.requirement,
          uncertaintyRule: prompts[task.checkpoints.ask_on_uncertainty ? PromptName.RuleAsk : PromptName.RuleAssume],
        }),
      });
      inBackground(taskId, async () => {
        try {
          await start;
        } catch (err) {
          // The runtime went away: the scheduler starts planning again when it is back.
          if (!(err instanceof AppError && err.code === ErrorCode.OpencodeNotReady)) throw err;
        }
      });
    },

    /** `submit_plan` (12 §6.4): a valid plan becomes a draft version; it runs at once unless it must be confirmed. */
    submitPlan(attempt: AttemptDTO, input: SubmitPlanInput): { version: number; accepted: true } {
      if (attempt.taskId === null) throw new Error(`Plan attempt ${attempt.id} has no task`);
      const task = get(attempt.taskId);
      const workflow = workflows.get(task.workflowId);
      const problems = validateSubmission(input, workflow.definition);
      if (problems.length > 0) {
        throw new AppError(ErrorCode.PlanInvalid, 'Plan graph is invalid', {
          problems: problems.map((p) => ({ ...p, hint: PLAN_PROBLEM_HINT[p.code] })),
        });
      }
      const confirmFirst = task.checkpoints.confirm_plan;
      return unit.transact(() => {
        const plan = plans.createDraft({
          taskId: task.id,
          source: PlanSource.Ai,
          graph: planGraphFromSubmission(input, workflow.definition),
          summary: input.summary,
          assumptions: input.assumptions ?? [],
          feedback: pendingReplanFeedback(task.id),
          createdByAttemptId: attempt.id,
        });
        attempts.markSubmitted(attempt.id);
        const next = move(task, TaskEvent.PlanSubmitted, confirmFirst ? TaskStatus.PlanReview : TaskStatus.Running);
        if (confirmFirst) requestPlanReview(next, plan);
        else confirmAndMaterialize(next, plan, workflow);
        return { version: plan.version, accepted: true as const };
      });
    },

    /** The user confirms the plan waiting for review (11 §6). */
    confirmPlan(taskId: string, version: number): void {
      const task = get(taskId);
      const draft = plans.draft(taskId);
      if (draft === undefined || draft.version !== version) {
        throw new AppError(ErrorCode.PlanVersionConflict, `Version ${version} is not the plan waiting for review`, {
          version,
          draft: draft?.version ?? null,
        });
      }
      const workflow = workflows.get(task.workflowId);
      unit.transact(() => {
        const running = move(task, TaskEvent.PlanConfirmed);
        confirmAndMaterialize(running, draft, workflow);
        inbox.resolveOpen({ taskId, kind: InboxKind.Plan }, { confirmed: true });
      });
    },

    /** The planner revises its plan in the same session with the user's feedback (12 §4.3). */
    replan(taskId: string, feedback: string): void {
      const task = get(taskId);
      const workflow = workflows.get(task.workflowId);
      const previous = attempts.latestPlanAttempt(taskId);
      if (workflow.planning !== WorkflowPlanning.Ai || previous === undefined) {
        throw new AppError(ErrorCode.ValidationFailed, 'Only plans made by the AI planner can be re-planned', {
          workflow: workflow.key,
        });
      }
      if (!attempts.isReady()) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      const roleId = attempts.roleIdOf(previous.id);
      if (roleId === null) throw new Error(`Plan attempt ${previous.id} has no role`);
      const planner = roles.get(roleId);
      unit.transact(() => {
        inbox.resolveOpen({ taskId, kind: InboxKind.Plan }, { replanFeedback: feedback });
        move(task, TaskEvent.ReplanRequested);
      });
      // Synchronous up to the attempt record, so the scheduler sees planning already under way.
      const continued = attempts.continueSession(previous.id, {
        prompt: renderTemplate(prompts[PromptName.Replan], { feedback }),
        agent: planner.baseAgent,
        system: planner.prompt,
      });
      inBackground(taskId, async () => {
        await continued;
      });
    },

    /** Cancel (09 §2): stop sessions, cancel nodes, close items, remove the worktree. */
    async cancel(taskId: string, keepBranch: boolean): Promise<void> {
      const task = get(taskId);
      unit.transact(() => {
        move(task, TaskEvent.Cancel, undefined, { finishedAt: clock.now() });
        nodes.cancelAll(taskId);
        inbox.dismissOpen({ taskId });
      });
      for (const attempt of attempts.listActive(taskId)) {
        // An attempt may end on its own while earlier ones are being aborted.
        const { status } = attempts.get(attempt.id);
        if (status === AttemptStatus.Starting || status === AttemptStatus.Running) await attempts.abort(attempt.id);
      }
      const worktree = worktrees.findByTask(taskId);
      if (worktree?.status === WorktreeStatus.Ready) {
        const { repoPath } = projects.getRecord(task.projectId);
        try {
          await worktrees.remove(worktree, { repoPath, deleteBranch: !keepBranch });
        } catch (err) {
          // The task is cancelled either way; the failure stays on the worktree (status error) for the Git console.
          if (!(err instanceof AppError)) throw err;
          log.warn({ err, taskId }, 'worktree removal failed');
        }
      }
    },

    /** Continue a failed task from its failed phase (09 §2); failed nodes get a fresh budget. */
    retry(taskId: string): void {
      const task = get(taskId);
      if (task.failedPhase === null) throw new Error(`Failed task ${taskId} has no failed phase`);
      const target = RETRY_TARGET[task.failedPhase];
      unit.transact(() => {
        move(task, TaskEvent.Retry, target, { failedPhase: null, failure: null, finishedAt: null });
        if (target === TaskStatus.Running) {
          for (const node of nodes.listByTask(taskId).filter((n) => n.status === NodeStatus.Failed))
            nodes.retry(node.id);
        }
        inbox.resolveOpen({ taskId, kind: InboxKind.Failure }, { action: FailureAction.Retry });
      });
      if (target === TaskStatus.Preparing) inBackground(taskId, () => prepare(taskId));
    },

    /** Startup: preparations cut short by the previous run continue (planning restarts through the scheduler). */
    recover(): void {
      for (const task of repo.list({ statuses: [TaskStatus.Preparing] })) inBackground(task.id, () => prepare(task.id));
    },
  };
}
export type TaskLifecycle = ReturnType<typeof createTaskLifecycle>;
