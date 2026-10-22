import {
  AcceptanceCheckKind,
  AppError,
  ErrorCode,
  InboxKind,
  InboxStatus,
  NodeStatus,
  TaskEvent,
  TaskFailedPhase,
  type TaskResultDTO,
  TaskStatus,
  WorkflowDeliverable,
} from '@aw/shared';
import { diffCommits, runGit } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';
import { taskDiffBase } from './tasks.diff.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/** Leaf nodes: no other node depends on them; their summaries describe the outcome of a report workflow. */
const leavesOf = (nodes: readonly Node[]) =>
  nodes.filter((n) => !nodes.some((other) => other.dependsOn.includes(n.key)));

/**
 * Derived task events from the scheduler (09 §2): every node finished → review with the result card (M3-10);
 * a node failed with nothing left running → the running phase failed.
 */
export function createTaskResults(deps: TasksServiceDeps, state: TaskState) {
  const { unit, inbox, nodes, plans, worktrees, workflows } = deps;
  const { get, move, fail } = state;

  /** The result card: diff against the base commit, check outcomes, node summaries and assumptions (10 §tasks). */
  async function computeResult(taskId: string): Promise<TaskResultDTO> {
    const task = get(taskId);
    const worktree = worktrees.findByTask(taskId);
    if (worktree === undefined) throw new AppError(ErrorCode.NotFound, `Task ${task.key} has no worktree`);
    const head = (await runGit(['rev-parse', 'HEAD'], { cwd: worktree.path })).stdout.trim();
    const files = await diffCommits(worktree.path, await taskDiffBase(worktree.path, task.baseBranch), head);
    const done = nodes
      .listByTask(taskId)
      .flatMap((node) =>
        node.status === NodeStatus.Done && node.result !== null ? [{ node, result: node.result }] : [],
      );
    const nodeSummaries = done.map(({ node, result }) => ({
      key: node.key,
      title: node.title,
      summary: result.summary,
    }));
    const report = workflows.get(task.workflowId).deliverable === WorkflowDeliverable.Report;
    const leaves = new Set(leavesOf(done.map((d) => d.node)).map((n) => n.key));
    const summarized = report ? nodeSummaries.filter((s) => leaves.has(s.key)) : nodeSummaries;
    const assumed = inbox
      .list({ taskId, kind: InboxKind.Question }, InboxStatus.Resolved)
      .flatMap((item) => (item.response !== null && 'assumed' in item.response ? [item.response.value] : []));
    return {
      summary:
        summarized.length === 1
          ? summarized.map((s) => s.summary).join('')
          : summarized.map((s) => `**${s.title}**\n\n${s.summary}`).join('\n\n'),
      filesChanged: files.length,
      insertions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
      deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
      files,
      checks: done.flatMap(({ node }) =>
        (node.checkResults ?? []).map((c) => ({
          nodeKey: node.key,
          nodeTitle: node.title,
          kind: c.kind,
          passed: c.passed,
          command: c.kind === AcceptanceCheckKind.Command ? c.command : null,
          skipped: c.kind === AcceptanceCheckKind.Command && c.skipped,
        })),
      ),
      nodeSummaries,
      assumptions: [
        ...(plans.confirmed(taskId)?.assumptions ?? []),
        ...done.flatMap(({ result }) => result.assumptions ?? []),
        ...assumed,
      ],
    };
  }

  return {
    /** `all_nodes_finished` → review: the result card and a delivery item (09 §2). */
    async finishRunning(taskId: string): Promise<void> {
      const result = await computeResult(taskId);
      const task = get(taskId);
      // Cancelled while the result was computed.
      if (task.status !== TaskStatus.Running) return;
      unit.transact(() => {
        move(task, TaskEvent.AllNodesFinished, undefined, { result });
        inbox.create({
          kind: InboxKind.Delivery,
          taskId,
          nodeId: null,
          attemptId: null,
          title: task.title,
          payload: {},
        });
      });
    },

    /**
     * `fail` in running: a node used up its budget, or its check command could not run (D115), and nothing else is
     * still working (09 §2).
     */
    failRunning(taskId: string): void {
      const task = get(taskId);
      const failed = nodes.listByTask(taskId).find((n) => n.status === NodeStatus.Failed);
      if (failed === undefined) throw new Error(`Task ${task.key} has no failed node`);
      const step = { nodeKey: failed.key, nodeTitle: failed.title };
      const unrunnable = nodes.unrunnableCheck(failed);
      fail(
        task,
        TaskFailedPhase.Running,
        unrunnable === null
          ? {
              code: ErrorCode.NodeAttemptsExhausted,
              message: `Step ${failed.key} failed after ${failed.attemptCount} attempts`,
              details: {
                ...step,
                feedback: failed.retryFeedback,
                command: nodes.failedCommand(failed)?.command ?? null,
              },
            }
          : {
              code: ErrorCode.CheckCommandUnrunnable,
              message: `Step ${failed.key} check \`${unrunnable.command}\` cannot run: ${unrunnable.program} ${unrunnable.reason}`,
              details: { ...step, ...unrunnable },
            },
      );
    },
  };
}
