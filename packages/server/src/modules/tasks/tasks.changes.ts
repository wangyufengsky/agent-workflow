import { PromptName, renderTemplate, SYSTEM_NODES, VERIFY_NODE } from '@aw/builtin';
import {
  AppError,
  AttachmentOwnerKind,
  ChangeRequestReason,
  type DeliveryDTO,
  DeliveryStatus,
  ErrorCode,
  InboxKind,
  NodeKind,
  NodeStatus,
  nodeAcceptanceSchema,
  type PlanNodeSpec,
  PlanSource,
  type RequestChangesRequest,
  type RequirementItemInput,
  TaskEvent,
  TaskEventEntity,
  TaskFailedPhase,
  TaskStatus,
  taskMachine,
  transition,
} from '@aw/shared';
import { backendCommitter, gitFailure, type RepoLocks, runGit, unmergedFiles } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';
import { acceptanceProject } from '../nodes/index.ts';
import { recordTaskEvent } from '../timeline/index.ts';
import type { Task } from './tasks.repo.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';
import { leafKeys } from './tasks.verify.ts';

/**
 * Merges `target` into a task worktree and leaves the conflict markers for a step to resolve (13 §4, 27 §3.6); the
 * merge stays in progress and the step's commit concludes it. Returns the conflicted files.
 */
export function mergeIntoWorktree(locks: RepoLocks, repoPath: string, dir: string, target: string): Promise<string[]> {
  return locks.run(repoPath, async () => {
    // git needs an identity even for a merge it does not commit yet; the backend's, as for every merge (D52).
    const args = [...backendCommitter(), 'merge', '--no-ff', '--no-commit', '--end-of-options', target];
    const result = await runGit(args, { cwd: dir, okExitCodes: [0, 1] });
    const files = await unmergedFiles(dir);
    if (result.exitCode === 1 && files.length === 0) throw gitFailure(args, result);
    return files;
  });
}

/**
 * Sending a task back to the AI (09 §2 `changes_requested`, 13 §4; `review_feedback`, 21 §3): a new plan version with one more step —
 * the user's requested changes, or the resolution of a conflicting merge — confirmed at once; back to `running`.
 */
export function createTaskChanges(
  deps: TasksServiceDeps,
  state: TaskState,
  currentDelivery: (taskId: string) => DeliveryDTO | null,
  retryVerification: (taskId: string) => void,
) {
  const { unit, prompts, projects, workflows, plans, nodes, inbox, locks, browser } = deps;
  const { get, move } = state;

  /** Merges the target into the task worktree for a conflict step (13 §4); returns the conflicted files. */
  const mergeTarget = (task: Task, targetBranch: string): Promise<string[]> => {
    const ctx = state.runContext(task);
    return mergeIntoWorktree(locks, ctx.repoPath, ctx.directory, targetBranch);
  };

  function nextKey(taskId: string, prefix: string): string {
    const taken = nodes.listByTask(taskId).filter((n) => n.key.startsWith(prefix)).length;
    return `${prefix}${taken + 1}`;
  }

  /**
   * One more step after all current ones, in a new plan version confirmed at once (13 §4); the task goes back to
   * `running` with `event`. Only the new node is materialized.
   */
  function appendRevision(
    task: Task,
    revision: { reason: ChangeRequestReason; instructions: string; feedback: string | null },
    event: typeof TaskEvent.ChangesRequested | typeof TaskEvent.ReviewFeedback,
    attachmentIds: readonly string[] = [],
  ): void {
    const confirmed = plans.confirmed(task.id);
    if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
    const system = SYSTEM_NODES[revision.reason];
    const spec: PlanNodeSpec = {
      key: nextKey(task.id, system.keyPrefix),
      title: system.title,
      roleKey: system.roleKey,
      instructions: revision.instructions,
      dependsOn: leafKeys(confirmed.graph.nodes),
      acceptance: system.acceptance,
      kind: NodeKind.Revise,
    };
    // With a checklist, the change is verified again after it (31 §2.3).
    const check = state.verify.stepAfter(task.id, nextKey(task.id, `${VERIFY_NODE.keyPrefix}_`), [spec.key]);
    const added = check === undefined ? [spec] : [spec, check];
    unit.transact(() => {
      const [node] = appendSteps(task, added, revision.feedback, event);
      if (node === undefined) throw new Error('No step was appended');
      deps.attachments.bind({ kind: AttachmentOwnerKind.TaskFeedback, id: node.id }, attachmentIds);
    });
  }

  /**
   * Adds `added` after the current steps in a new plan version confirmed at once (13 §4), and sends the task back to
   * `running` with `event`. Only the new nodes are materialized.
   */
  function appendSteps(
    task: Task,
    added: readonly PlanNodeSpec[],
    feedback: string | null,
    event: typeof TaskEvent.ChangesRequested | typeof TaskEvent.ReviewFeedback,
  ): Node[] {
    const confirmed = plans.confirmed(task.id);
    if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
    const workflow = workflows.get(task.workflowId);
    return unit.transact(() => {
      const plan = plans.createDraft({
        taskId: task.id,
        source: PlanSource.User,
        graph: { nodes: [...confirmed.graph.nodes, ...added] },
        summary: confirmed.summary,
        assumptions: confirmed.assumptions,
        feedback,
        createdByAttemptId: null,
      });
      plans.confirm(plan.id);
      const input = {
        taskId: task.id,
        planId: plan.id,
        ...acceptanceProject(projects.getRecord(task.projectId)),
        defaultAcceptance: workflow.definition.defaultAcceptance,
        acceptEachNode: task.checkpoints.accept_each_node,
      };
      const appended = added.map((spec) => nodes.append(input, spec));
      // The task leaves review; reaching it again opens a new delivery item.
      inbox.dismissOpen({ taskId: task.id, kind: InboxKind.Delivery });
      // A completed task is not finished any more (21 §7), nor archived (D219).
      move(get(task.id), event, undefined, { currentPlanId: plan.id, finishedAt: null, archivedAt: null });
      return appended;
    });
  }

  return {
    /** 「重新核验」(31 §2.3): one more verify step after everything, for a task in review. */
    async reverifyRequirements(
      taskId: string,
      revisionId?: string,
      expectedCommitSha?: string,
      items?: readonly RequirementItemInput[],
    ): Promise<void> {
      const initial = get(taskId);
      const ctx = state.runContext(initial);
      await locks.run(ctx.repoPath, async () => {
        // Refuse a missing or unusable worktree before changing either the checklist or the plan.
        const head = (await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: ctx.directory })).stdout.trim();
        if (expectedCommitSha !== undefined && head !== expectedCommitSha) {
          throw new AppError(ErrorCode.RequirementsNotEditable, 'The result commit changed since it was opened', {
            expectedCommitSha,
            head,
          });
        }
        unit.transact(() => {
          const task = get(taskId);
          const failed = nodes.listByTask(task.id).filter((node) => node.status === NodeStatus.Failed);
          const failedVerify =
            task.status === TaskStatus.Failed &&
            task.failedPhase === TaskFailedPhase.Running &&
            failed.length === 1 &&
            failed[0]?.kind === NodeKind.Verify
              ? failed[0]
              : undefined;
          const hasResult = nodes
            .listByTask(task.id)
            .some((node) => node.kind !== NodeKind.Verify && node.status === NodeStatus.Done && node.result !== null);
          if (!hasResult || (task.status !== TaskStatus.Review && failedVerify === undefined)) {
            throw new AppError(
              ErrorCode.RequirementsNotEditable,
              `Task ${task.key} has no result ready for verification`,
              {
                status: task.status,
              },
            );
          }
          const current = deps.requirements.current(task.id);
          if (revisionId !== undefined && current?.id !== revisionId) {
            throw new AppError(ErrorCode.RequirementsNotEditable, 'The checklist changed since it was opened', {
              revisionId,
            });
          }
          if (items !== undefined) {
            if (revisionId === undefined || expectedCommitSha === undefined) {
              throw new AppError(
                ErrorCode.ValidationFailed,
                'A checklist revision and result commit are required when editing',
                {
                  issues: [
                    {
                      path: ['revisionId'],
                      message: 'revision and result commit are required when items are provided',
                    },
                  ],
                },
              );
            }
            deps.requirements.save(task.id, items);
          }
          const confirmed = plans.confirmed(task.id);
          if (confirmed === undefined) throw new Error(`Task ${task.key} has no confirmed plan`);
          const step = state.verify.stepAfter(
            task.id,
            nextKey(task.id, `${VERIFY_NODE.keyPrefix}_`),
            leafKeys(confirmed.graph.nodes),
          );
          if (step === undefined) {
            throw new AppError(ErrorCode.ValidationFailed, `Task ${task.key} has no checklist`, {
              issues: [{ path: ['id'], message: 'the task has no acceptance checklist' }],
            });
          }
          recordTaskEvent(deps.db, {
            taskId: task.id,
            entity: TaskEventEntity.Plan,
            entityId: task.id,
            type: 'requirements_reverified',
            payload: {
              previousRevisionId: current?.id ?? null,
              revisionId: deps.requirements.current(task.id)?.id ?? null,
              commitSha: head,
            },
            createdAt: deps.clock.now(),
          });
          if (failedVerify !== undefined) {
            nodes.setVerification(failedVerify.id, step.instructions, nodeAcceptanceSchema.parse(step.acceptance));
            retryVerification(task.id);
          } else {
            appendSteps(task, [step], null, TaskEvent.ChangesRequested);
          }
        });
      });
    },

    async requestChanges(
      taskId: string,
      reason: RequestChangesRequest['reason'],
      feedback: string | undefined,
      attachmentIds: readonly string[] = [],
      page?: RequestChangesRequest['page'],
    ): Promise<void> {
      const task = get(taskId);
      transition(taskMachine, task.status, TaskEvent.ChangesRequested);
      let instructions: string;
      if (reason === ChangeRequestReason.User) {
        if (feedback === undefined) {
          throw new AppError(ErrorCode.ValidationFailed, 'Asking for changes needs feedback', {
            issues: [{ path: ['feedback'], message: 'required when reason is user' }],
          });
        }
        // The page the user looked at goes with the feedback, read from their own tab (29 §2.3).
        const withPage = page === undefined ? feedback : `${feedback}\n\n${browser.pageNote(taskId, page.tabId)}`;
        instructions = renderTemplate(prompts[PromptName.Revise], {
          feedback: withPage,
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
      appendRevision(
        task,
        { reason, instructions, feedback: feedback ?? null },
        TaskEvent.ChangesRequested,
        attachmentIds,
      );
    },

    appendRevision,
  };
}
export type TaskChangeRequests = ReturnType<typeof createTaskChanges>;
