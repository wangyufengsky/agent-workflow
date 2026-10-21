import { randomUUID } from 'node:crypto';
import {
  AppError,
  BATCH_KEY_PREFIX,
  BatchDeliveryOutcome,
  type BatchDeliveryResultDTO,
  type BatchDetailDTO,
  type BatchItemDTO,
  type BatchSummaryDTO,
  batchCounts,
  type CreateBatchRequest,
  type DeliverBatchResponse,
  DeliveryStatus,
  DeliveryStrategy,
  ErrorCode,
  isBatchDeliverable,
  isTerminalState,
  type ListBatchesQuery,
  type LocalMergeStrategy,
  renderBatchRequirement,
  TASK_TITLE_MAX_CHARS,
  TaskStatus,
  type TaskSummaryDTO,
  taskMachine,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { type Batch, type BatchLink, createBatchesRepo } from './batches.repo.ts';

export type BatchesServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  workflows: WorkflowsService;
  tasks: TasksService;
};

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';

/**
 * Batches (20): one fixed workflow run on several targets, one ordinary task per target. A batch only groups its
 * tasks; its progress is derived from theirs and delivering it delivers each of them in turn.
 */
export function createBatchesService({ db, unit, clock, log, settings, workflows, tasks }: BatchesServiceDeps) {
  const repo = createBatchesRepo(db);

  function get(id: string): Batch {
    const batch = repo.find(id);
    if (batch === undefined) throw new AppError(ErrorCode.BatchNotFound, `Batch ${id} not found`, { id });
    return batch;
  }

  function summary(batch: Batch, taskSummaries: readonly TaskSummaryDTO[]): BatchSummaryDTO {
    return {
      id: batch.id,
      key: `${BATCH_KEY_PREFIX}${batch.seq}`,
      title: batch.title,
      project: { id: batch.projectId, name: batch.projectName },
      workflow: {
        id: batch.workflowId,
        key: batch.workflowKey,
        name: batch.workflowName,
        deliverable: batch.workflowDeliverable,
      },
      total: taskSummaries.length,
      counts: batchCounts(taskSummaries.map((t) => t.displayGroup)),
      ended: taskSummaries.filter((t) => isTerminalState(taskMachine, t.status)).length,
      createdAt: batch.createdAt,
    };
  }

  function detail(id: string): BatchDetailDTO {
    const batch = get(id);
    const links = repo.links([id]);
    const taskSummaries = tasks.summariesOf(links.map((l) => l.taskId));
    const items = links.map(
      (link, i): BatchItemDTO => ({
        position: link.position,
        target: link.target,
        task: taskSummaries[i] ?? missingTask(link),
        // At most BATCH_TARGETS_MAX tasks: each one's current round is read on its own.
        lastDelivery: tasks.lastDelivery(link.taskId),
      }),
    );
    return {
      ...summary(batch, taskSummaries),
      requirementTemplate: batch.requirementTemplate,
      baseBranch: batch.baseBranch,
      items,
    };
  }

  /** `tasks.summariesOf` returns one summary per id, in order. */
  const missingTask = (link: BatchLink): never => {
    throw new Error(`No summary for task ${link.taskId} of batch ${link.batchId}`);
  };

  /** Delivers one task of the batch; a conflict or failure is its outcome, the batch goes on (20 §5). */
  async function deliverItem(
    item: BatchItemDTO,
    strategy: LocalMergeStrategy | typeof DeliveryStrategy.ReportOnly,
  ): Promise<BatchDeliveryResultDTO> {
    const base = { taskId: item.task.id, taskKey: item.task.key, target: item.target };
    let delivered: Awaited<ReturnType<TasksService['deliver']>>;
    try {
      delivered = await tasks.deliver(item.task.id, { strategy });
    } catch (err) {
      // A check before merging failed and nothing changed (11 §5.3): the task stays in review with the reason.
      if (!(err instanceof AppError)) throw err;
      return { ...base, outcome: BatchDeliveryOutcome.Failed, error: err.toInfo() };
    }
    if (delivered.status === TaskStatus.Completed) {
      return { ...base, outcome: BatchDeliveryOutcome.Delivered, error: null };
    }
    const { lastDelivery } = delivered;
    if (lastDelivery === null) throw new Error(`Task ${item.task.key} was delivered without a delivery record`);
    const outcome =
      lastDelivery.status === DeliveryStatus.Conflict ? BatchDeliveryOutcome.Conflict : BatchDeliveryOutcome.Failed;
    return { ...base, outcome, error: lastDelivery.error };
  }

  return {
    detail,

    /** A page of batches with their progress (20 §7): one query for the batches, one for their tasks. */
    list({ projectId, limit, cursor }: ListBatchesQuery): { items: BatchSummaryDTO[]; nextCursor: string | null } {
      const rows = repo.page({
        projectId,
        beforeSeq: cursor === undefined ? undefined : Number(cursor),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const links = repo.links(page.map((b) => b.id));
      const byTask = new Map(tasks.summariesOf(links.map((l) => l.taskId)).map((t) => [t.id, t]));
      const items = page.map((batch) =>
        summary(
          batch,
          links.filter((l) => l.batchId === batch.id).map((l) => byTask.get(l.taskId) ?? missingTask(l)),
        ),
      );
      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last !== undefined ? String(last.seq) : null };
    },

    /**
     * Creates the batch and a task per target in one transaction, then starts the tasks in target order (20 §2).
     * Only fixed workflows: their plan is the template, so the tasks do not wait for plan confirmation (D85).
     */
    async create(input: CreateBatchRequest): Promise<BatchDetailDTO> {
      const workflow = workflows.get(input.workflowId);
      if (workflow.planning !== WorkflowPlanning.Fixed) {
        throw new AppError(ErrorCode.ValidationFailed, 'Only fixed workflows can run as a batch', {
          issues: [{ path: ['workflowId'], message: `workflow ${workflow.key} is planned by AI` }],
        });
      }
      const baseBranch = await tasks.checkCreate(input);
      const id = randomUUID();
      const taskIds = unit.transact(() => {
        repo.insert({
          id,
          projectId: input.projectId,
          workflowId: workflow.id,
          title: firstLine(input.requirementTemplate).slice(0, TASK_TITLE_MAX_CHARS),
          requirementTemplate: input.requirementTemplate,
          baseBranch,
          createdAt: clock.now(),
        });
        return input.targets.map((target, position) => {
          const taskId = tasks.insertDraft({
            projectId: input.projectId,
            workflowId: workflow.id,
            requirement: renderBatchRequirement(input.requirementTemplate, target),
            baseBranch,
            checkpoints: { confirm_plan: false },
          });
          repo.link({ batchId: id, taskId, position, target });
          return taskId;
        });
      });
      log.info({ batchId: id, workflow: workflow.key, tasks: taskIds.length }, 'batch created');
      for (const taskId of taskIds) tasks.start(taskId);
      return detail(id);
    },

    /**
     * 「合并全部待合并的」(20 §5, D86): every task waiting for review is delivered in target order, as its own
     * result card would; a conflicting or failing one stays in review and the others go on.
     */
    async deliver(id: string, strategy: LocalMergeStrategy | undefined): Promise<DeliverBatchResponse> {
      const batch = detail(id);
      const used =
        batch.workflow.deliverable === WorkflowDeliverable.Report
          ? DeliveryStrategy.ReportOnly
          : (strategy ?? settings.get('delivery.defaultStrategy'));
      const outcomes: BatchDeliveryResultDTO[] = [];
      // One after another: merges into the same branch take the repository lock in turn anyway.
      for (const item of batch.items.filter(isBatchDeliverable)) outcomes.push(await deliverItem(item, used));
      log.info({ batchId: id, outcomes: outcomes.map((o) => o.outcome) }, 'batch delivered');
      return { batch: detail(id), outcomes };
    },
  };
}
export type BatchesService = ReturnType<typeof createBatchesService>;
