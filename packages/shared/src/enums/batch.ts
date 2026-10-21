import { z } from 'zod';

/** How delivering one task of a batch ended (20 §5). */
export const BatchDeliveryOutcome = {
  /** Merged into its base branch, or a report finished: the task is completed. */
  Delivered: 'delivered',
  /** The merge conflicted; the task waits in review for the user. */
  Conflict: 'conflict',
  /** A check before merging, the merge or the finishing failed; the task waits in review. */
  Failed: 'failed',
} as const;
export type BatchDeliveryOutcome = (typeof BatchDeliveryOutcome)[keyof typeof BatchDeliveryOutcome];
export const batchDeliveryOutcomeSchema = z.enum(BatchDeliveryOutcome);
