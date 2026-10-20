import { PromptName, renderTemplate, SYSTEM_NODES } from '@aw/builtin';
import {
  AppError,
  ChangeRequestReason,
  type DeliveryDTO,
  DeliveryStatus,
  ErrorCode,
  InboxKind,
  NodeKind,
  type PlanNodeSpec,
  PlanSource,
  TaskEvent,
  taskMachine,
  transition,
} from '@aw/shared';
import { gitFailure, runGit, unmergedFiles } from '../git/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/** Nodes nothing else depends on: the new step comes after all of them (13 §4). */
const leafKeys = (nodes: ReadonlyArray<{ key: string; dependsOn: readonly string[] }>) =>
  nodes.filter((n) => !nodes.some((other) => other.dependsOn.includes(n.key))).map((n) => n.key);

/**
 * Sending a task in review back to the AI (09 §2 `changes_requested`, 13 §4): a new plan version with one more step —
 * the user's requested changes, or the resolution of a conflicting merge — confirmed at once; back to `running`.
 */
export function createTaskChanges(
  deps: TasksServiceDeps,
  state: TaskState,
  currentDelivery: (taskId: string) => DeliveryDTO | null,
) {
  const { unit, prompts, projects, workflows, plans, nodes, inbox, locks } = deps;
  const { get, move } = state;

  /**
   * Merges the target branch into the task worktree and leaves the conflict markers for the step (13 §4); the
   * merge stays in progress and the step's commit concludes it. Returns the conflicted files.
   */
  async function mergeTarget(task: Task, targetBranch: string): Promise<string[]> {
    const ctx = state.runContext(task);
    return locks.run(ctx.repoPath, async () => {
      const args = ['merge', '--no-ff', '--no-commit', '--end-of-options', targetBranch];
      const result = await runGit(args, { cwd: ctx.directory, okExitCodes: [0, 1] });
      const files = await unmergedFiles(ctx.directory);
      if (result.exitCode === 1 && files.length === 0) throw gitFailure(args, result);
      return files;
    });
  }

  function nextKey(taskId: string, prefix: string): string {
    const taken = nodes.listByTask(taskId).filter((n) => n.key.startsWith(prefix)).length;
    return `${prefix}${taken + 1}`;
  }

  return {
    async requestChanges(taskId: string, reason: ChangeRequestReason, feedback: string | undefined): Promise<void> {
      const task = get(taskId);
      transition(taskMachine, task.status, TaskEvent.ChangesRequested);
      const confirmed = plans.confirmed(taskId);
      if (confirmed === undefined) throw new Error(`Task ${task.key} in review has no confirmed plan`);
      const system = SYSTEM_NODES[reason];
      let instructions: string;
      if (reason === ChangeRequestReason.User) {
        if (feedback === undefined) {
          throw new AppError(ErrorCode.ValidationFailed, 'Asking for changes needs feedback', {
            issues: [{ path: ['feedback'], message: 'required when reason is user' }],
          });
        }
        instructions = renderTemplate(prompts[PromptName.Revise], {
          feedback,
          resultSummary: task.result?.summary ?? '',
        });
      } else {
        const delivery = currentDelivery(taskId);
        if (delivery?.status !== DeliveryStatus.Conflict) {
          throw new AppError(ErrorCode.ValidationFailed, 'The last delivery did not conflict', {
            issues: [{ path: ['reason'], message: 'conflict needs a conflicting delivery' }],
          });
        }
        const files = await mergeTarget(task, delivery.targetBranch);
        instructions = renderTemplate(prompts[PromptName.ReviseConflict], {
          targetBranch: delivery.targetBranch,
          files: files.map((f) => `- \`${f}\``).join('\n'),
        });
      }
      const spec: PlanNodeSpec = {
        key: nextKey(taskId, system.keyPrefix),
        title: system.title,
        roleKey: system.roleKey,
        instructions,
        dependsOn: leafKeys(confirmed.graph.nodes),
        acceptance: system.acceptance,
        kind: NodeKind.Revise,
      };
      const workflow = workflows.get(task.workflowId);
      unit.transact(() => {
        const plan = plans.createDraft({
          taskId,
          source: PlanSource.User,
          graph: { nodes: [...confirmed.graph.nodes, spec] },
          summary: confirmed.summary,
          assumptions: confirmed.assumptions,
          feedback: feedback ?? null,
          createdByAttemptId: null,
        });
        plans.confirm(plan.id);
        nodes.append(
          {
            taskId,
            planId: plan.id,
            checkCommand: projects.getRecord(task.projectId).checkCommand,
            defaultAcceptance: workflow.definition.defaultAcceptance,
            acceptEachNode: task.checkpoints.accept_each_node,
          },
          spec,
        );
        // The task leaves review; reaching it again opens a new delivery item.
        inbox.dismissOpen({ taskId, kind: InboxKind.Delivery });
        move(get(taskId), TaskEvent.ChangesRequested, undefined, { currentPlanId: plan.id });
      });
    },
  };
}
