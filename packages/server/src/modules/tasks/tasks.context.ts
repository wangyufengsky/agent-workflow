import {
  AppError,
  type AskUserInput,
  type AskUserOutput,
  AskUserStatus,
  type AttemptDTO,
  AttemptKind,
  ErrorCode,
  InboxKind,
  InboxStatus,
  type NodeOutput,
  PLAN_MAX_NODES,
  type TaskContext,
  type TaskDiffOutput,
  WorkflowPlanning,
  WorktreeStatus,
} from '@aw/shared';
import { diffWorktree, diffWorktreeFile } from '../git/index.ts';
import { taskDiffBase } from './tasks.diff.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/** Told to the model after `ask_user` queued a question (12 §6.7). */
const QUEUED_INSTRUCTION = {
  blocking: 'End your turn now. The answer will be sent as the next message.',
  nonBlocking: 'Continue working; the answer will be sent when available.',
} as const;

/** What the execution MCP tools read about the attempt's task (12 §6.1–6.3, 6.7). */
export function createTaskContext(deps: TasksServiceDeps, state: TaskState) {
  const { inbox, nodes, plans, worktrees, workflows, roles, projects } = deps;

  function taskOf(attempt: AttemptDTO): Task {
    if (attempt.taskId === null) throw new Error(`Attempt ${attempt.id} belongs to no task`);
    return state.get(attempt.taskId);
  }

  function readyWorktree(task: Task) {
    const worktree = worktrees.findByTask(task.id);
    if (worktree?.status !== WorktreeStatus.Ready) throw new Error(`Task ${task.key} has no ready worktree`);
    return worktree;
  }

  /** Questions answered by the user or by the model's own assumption. */
  function answeredQuestions(taskId: string): TaskContext['answeredQuestions'] {
    return inbox
      .list({ taskId, kind: InboxKind.Question }, InboxStatus.Resolved)
      .reverse()
      .flatMap((item) => {
        if (item.kind !== InboxKind.Question || item.response === null) return [];
        const answer = 'answer' in item.response ? item.response.answer : `(assumed) ${item.response.value}`;
        return [{ question: item.payload.question, answer }];
      });
  }

  /** Re-planning feedback and rejections of the node's results, oldest first. */
  function userFeedback(taskId: string, nodeId: string | null): string[] {
    const fromPlans = plans
      .list(taskId)
      .reverse()
      .flatMap((p) => (p.feedback === null ? [] : [{ at: p.createdAt, text: p.feedback }]));
    const fromRejections =
      nodeId === null
        ? []
        : inbox
            .list({ nodeId, kind: InboxKind.Acceptance }, InboxStatus.Resolved)
            .flatMap((item) =>
              item.kind === InboxKind.Acceptance && item.response?.feedback !== undefined && item.resolvedAt !== null
                ? [{ at: item.resolvedAt, text: item.response.feedback }]
                : [],
            );
    return [...fromPlans, ...fromRejections].sort((a, b) => a.at - b.at).map((f) => f.text);
  }

  return {
    /** `get_task_context` (12 §6.1). */
    taskContext(attempt: AttemptDTO): TaskContext {
      const task = taskOf(attempt);
      const workflow = workflows.get(task.workflowId);
      const project = projects.getRecord(task.projectId);
      const worktree = readyWorktree(task);
      const all = nodes.listByTask(task.id);
      const node = attempt.nodeId === null ? undefined : all.find((n) => n.id === attempt.nodeId);
      const plan = plans.confirmed(task.id);
      const isPlanning = attempt.kind === AttemptKind.Plan && workflow.planning === WorkflowPlanning.Ai;
      return {
        task: {
          key: task.key,
          title: task.title,
          requirement: task.requirement,
          workflow: workflow.name,
          deliverable: workflow.deliverable,
        },
        project: { name: project.name, defaultBranch: project.defaultBranch },
        workspace: { path: worktree.path, branch: worktree.branch, baseCommit: worktree.baseCommit },
        attempt: {
          kind: attempt.kind,
          seq: attempt.seq,
          ...(attempt.kind === AttemptKind.Execute && node !== undefined && node.retryFeedback !== null
            ? { retryFeedback: node.retryFeedback }
            : {}),
        },
        askOnUncertainty: task.checkpoints.ask_on_uncertainty,
        ...(plan === undefined
          ? {}
          : {
              plan: {
                version: plan.version,
                ...(plan.summary === null ? {} : { summary: plan.summary }),
                nodes: all.map((n) => ({
                  key: n.key,
                  title: n.title,
                  role: n.roleKey,
                  status: n.status,
                  dependsOn: n.dependsOn,
                  ...(n.result === null ? {} : { resultSummary: n.result.summary }),
                })),
              },
            }),
        ...(node === undefined
          ? {}
          : {
              node: {
                key: node.key,
                title: node.title,
                role: node.roleKey,
                instructions: node.instructions,
                acceptance: node.acceptance,
                dependsOn: node.dependsOn,
              },
            }),
        upstream:
          node === undefined
            ? []
            : all.flatMap((n) =>
                node.dependsOn.includes(n.key) && n.result !== null
                  ? [
                      {
                        key: n.key,
                        title: n.title,
                        summary: n.result.summary,
                        changedFiles: (n.result.changes ?? []).map((c) => c.path),
                      },
                    ]
                  : [],
              ),
        answeredQuestions: answeredQuestions(task.id),
        userFeedback: userFeedback(task.id, attempt.nodeId),
        ...(isPlanning
          ? {
              planning: {
                ...(workflow.definition.plannerGuidance === undefined
                  ? {}
                  : { guidance: workflow.definition.plannerGuidance }),
                allowedRoles: workflow.definition.allowedRoles.map((key) => {
                  const role = roles.getByKey(key);
                  return { key, name: role.name, description: role.description };
                }),
                requiredSteps: workflow.definition.requiredSteps ?? [],
                maxNodes: PLAN_MAX_NODES,
              },
            }
          : {}),
        databases: [],
      };
    },

    /** `get_node_output` (12 §6.2). */
    nodeOutput: (attempt: AttemptDTO, key: string): NodeOutput => nodes.output(taskOf(attempt).id, key),

    /** `get_task_diff` (12 §6.3): the worktree, committed or not, against the base commit. */
    async taskDiff(attempt: AttemptDTO, path: string | undefined): Promise<TaskDiffOutput> {
      const task = taskOf(attempt);
      const worktree = readyWorktree(task);
      const base = await taskDiffBase(worktree.path, task.baseBranch);
      const files = await diffWorktree(worktree.path, base);
      if (path === undefined) return { files };
      const file = files.find((f) => f.path === path);
      if (file === undefined) {
        throw new AppError(ErrorCode.ValidationFailed, `${path} has no changes in this task`, {
          issues: [{ path: ['path'], message: 'not a changed file; call without path to list them' }],
        });
      }
      return { path, diff: await diffWorktreeFile(worktree.path, base, path) };
    },

    /** `ask_user` (12 §6.7): ask, or record the model's assumption when the user prefers not to be asked. */
    askUser(attempt: AttemptDTO, input: AskUserInput): AskUserOutput {
      const task = taskOf(attempt);
      const asks = task.checkpoints.ask_on_uncertainty;
      const item = {
        kind: InboxKind.Question,
        taskId: task.id,
        nodeId: attempt.nodeId,
        attemptId: attempt.id,
        title: input.question,
        payload: {
          question: input.question,
          ...(input.options === undefined ? {} : { options: input.options }),
          blocking: input.blocking,
          ...(input.default_assumption === undefined ? {} : { defaultAssumption: input.default_assumption }),
        },
      } as const;
      if (!asks && input.default_assumption !== undefined) {
        inbox.createResolved(item, { assumed: true, value: input.default_assumption });
        return { status: AskUserStatus.Assumed, proceed_with: input.default_assumption };
      }
      if (!asks && !input.blocking) {
        throw new AppError(ErrorCode.ValidationFailed, 'A non-blocking question needs a default assumption', {
          issues: [{ path: ['default_assumption'], message: 'required when the question does not block you' }],
        });
      }
      // Blocking without an assumption is asked even when the user prefers assumptions: there is nothing to assume.
      inbox.create(item);
      return {
        status: AskUserStatus.Queued,
        instruction: input.blocking ? QUEUED_INSTRUCTION.blocking : QUEUED_INSTRUCTION.nonBlocking,
      };
    },
  };
}
