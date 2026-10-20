import { randomUUID } from 'node:crypto';
import type { WorkflowSeed } from '@aw/builtin';
import {
  AppError,
  ErrorCode,
  type UpdateWorkflowRequest,
  type WorkflowDTO,
  WorkflowKind,
  type WorkflowSummaryDTO,
  workflowDefinitionSchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import { createWorkflowsRepo } from './workflows.repo.ts';

export type WorkflowsServiceDeps = { db: Db; clock: Clock; log: Logger };

type VersionContent = Pick<WorkflowDTO, 'name' | 'description' | 'planning' | 'deliverable' | 'definition'>;

/** Compared through the schema so that key order (seed literal vs parsed JSON) does not count as a change. */
const contentOf = (w: VersionContent): string =>
  JSON.stringify([w.name, w.description, w.planning, w.deliverable, workflowDefinitionSchema.parse(w.definition)]);

function toSummary({ definition: _definition, ...summary }: WorkflowDTO): WorkflowSummaryDTO {
  return summary;
}

export function createWorkflowsService({ db, clock, log }: WorkflowsServiceDeps) {
  const repo = createWorkflowsRepo(db);

  function get(id: string): WorkflowDTO {
    const workflow = repo.find(id);
    if (workflow === undefined) throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${id} not found`, { id });
    return workflow;
  }

  return {
    list: (): WorkflowSummaryDTO[] => repo.listLatest().map(toSummary),
    get,

    /**
     * Writes the built-in workflows of this app version (13): a new or changed definition becomes a new latest
     * version; older versions stay for the tasks that use them.
     */
    syncBuiltin(seeds: readonly WorkflowSeed[]): void {
      const now = clock.now();
      db.transaction((tx) => {
        const txRepo = createWorkflowsRepo(tx);
        for (const seed of seeds) {
          const latest = txRepo.findLatest(seed.key);
          if (latest !== undefined && contentOf(latest) === contentOf(seed)) continue;
          const version = (latest?.version ?? 0) + 1;
          txRepo.insertLatest({ ...seed, id: randomUUID(), version, kind: WorkflowKind.Builtin, createdAt: now });
          log.info({ workflow: seed.key, version }, 'builtin workflow version added');
        }
      });
    },

    /** A custom workflow is saved as a new version; running tasks keep the version they started with (13 §5). */
    update({ id, ...changes }: UpdateWorkflowRequest): WorkflowDTO {
      const current = get(id);
      if (current.kind === WorkflowKind.Builtin) {
        throw new AppError(
          ErrorCode.WorkflowReadonly,
          'Built-in workflows are read-only; copy the workflow to change it',
          {
            id,
          },
        );
      }
      const latest = repo.findLatest(current.key);
      const next: WorkflowDTO = {
        ...current,
        name: changes.name ?? current.name,
        description: changes.description ?? current.description,
        definition: changes.definition ?? current.definition,
        id: randomUUID(),
        version: (latest?.version ?? current.version) + 1,
        createdAt: clock.now(),
      };
      db.transaction((tx) => createWorkflowsRepo(tx).insertLatest(next));
      return get(next.id);
    },
  };
}
export type WorkflowsService = ReturnType<typeof createWorkflowsService>;
