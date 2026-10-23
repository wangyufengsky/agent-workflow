import { randomUUID } from 'node:crypto';
import {
  AppError,
  ErrorCode,
  type RequirementItem,
  type RequirementItemInput,
  requirementItemsInputSchema,
  type TaskRequirementsDTO,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import { createRequirementsRepo } from './requirements.repo.ts';
import { displayStatus } from './requirements.status.ts';

export type RequirementsServiceDeps = { db: Db; clock: Clock };

/**
 * A task's acceptance checklist (31): immutable versions and the conclusions on their items. When the checklist may
 * be edited is the task's to decide (`tasks`); this module only keeps the records and derives the states.
 */
export function createRequirementsService({ db, clock }: RequirementsServiceDeps) {
  const repo = createRequirementsRepo(db);

  return {
    /**
     * Saves `inputs` as the task's next version, inside the caller's transaction. An input with an `id` keeps that
     * item of the current version (its conclusions stay its own, if stale); one without gets a new id.
     */
    save(taskId: string, inputs: readonly RequirementItemInput[]): void {
      const [current] = repo.listRevisions(taskId);
      const known = new Set(current?.items.map((item) => item.id) ?? []);
      const items: RequirementItem[] = requirementItemsInputSchema.parse(inputs).map(({ id, ...item }, index) => {
        if (id !== undefined && !known.has(id)) {
          throw new AppError(ErrorCode.ValidationFailed, `No item ${id} in the current checklist`, {
            issues: [{ path: ['items', index, 'id'], message: 'not an item of the current checklist' }],
          });
        }
        return { id: id ?? randomUUID(), ...item };
      });
      if (new Set(items.map((item) => item.id)).size !== items.length) {
        throw new AppError(ErrorCode.ValidationFailed, 'An item is listed twice', {
          issues: [{ path: ['items'], message: 'an item id appears twice' }],
        });
      }
      repo.insertRevision({ id: randomUUID(), taskId, seq: (current?.seq ?? 0) + 1, items, createdAt: clock.now() });
    },

    /** The current version with each item's state against `commitSha` (null when the task's commit is unknown). */
    view(taskId: string, commitSha: string | null): TaskRequirementsDTO {
      const [current, ...older] = repo.listRevisions(taskId);
      if (current === undefined) return { revision: null, items: [], history: [] };
      const results = repo.listResults(taskId);
      const baseline = { revisionId: current.id, commitSha };
      return {
        revision: { id: current.id, seq: current.seq, createdAt: current.createdAt },
        items: current.items.map((item) => ({
          ...item,
          ...displayStatus(
            results.filter((r) => r.itemId === item.id),
            baseline,
          ),
        })),
        history: older.map(({ id, seq, createdAt }) => ({ id, seq, createdAt })),
      };
    },
  };
}
export type RequirementsService = ReturnType<typeof createRequirementsService>;
