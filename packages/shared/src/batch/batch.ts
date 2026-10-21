import { BATCH_TARGET_PLACEHOLDER } from '../constants/app.ts';
import type { DeliveryDTO } from '../contracts/api/delivery.ts';
import { DeliveryStatus } from '../enums/git.ts';
import { TASK_DISPLAY_GROUPS, type TaskDisplayGroup, TaskStatus } from '../enums/task.ts';

/** A task's requirement in a batch: every placeholder of the template replaced by the target (20 §2). */
export const renderBatchRequirement = (template: string, target: string): string =>
  template.replaceAll(BATCH_TARGET_PLACEHOLDER, target);

/** How many tasks of a batch are in each display group (20 §4): the groups that have tasks, in display order. */
export function batchCounts(groups: readonly TaskDisplayGroup[]): Array<{ group: TaskDisplayGroup; count: number }> {
  return TASK_DISPLAY_GROUPS.flatMap((group) => {
    const count = groups.filter((g) => g === group).length;
    return count === 0 ? [] : [{ group, count }];
  });
}

/**
 * Whether「合并全部待合并的」delivers a task (20 §5): it waits in review and its current round's delivery did not
 * conflict — merging it again would only conflict again, the user hands it to the AI first.
 */
export const isBatchDeliverable = (item: {
  task: { status: TaskStatus };
  lastDelivery: Pick<DeliveryDTO, 'status'> | null;
}): boolean => item.task.status === TaskStatus.Review && item.lastDelivery?.status !== DeliveryStatus.Conflict;
