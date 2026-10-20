import { randomUUID } from 'node:crypto';
import type { WorkflowSeed } from '@aw/builtin';
import {
  AppError,
  type CreateWorkflowRequest,
  ErrorCode,
  type UpdateWorkflowRequest,
  type ValidateWorkflowResponse,
  validateWorkflowDefinition,
  type WorkflowDTO,
  WorkflowKind,
  type WorkflowShape,
  type WorkflowSummaryDTO,
  workflowDefinitionSchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import type { RolesService } from '../roles/index.ts';
import { createWorkflowsRepo } from './workflows.repo.ts';

export type WorkflowsServiceDeps = { db: Db; clock: Clock; log: Logger; roles: RolesService };

type VersionContent = Pick<WorkflowDTO, 'name' | 'description' | 'planning' | 'deliverable' | 'definition'>;

/** Compared through the schema so that key order (seed literal vs parsed JSON) does not count as a change. */
const contentOf = (w: VersionContent): string =>
  JSON.stringify([w.name, w.description, w.planning, w.deliverable, workflowDefinitionSchema.parse(w.definition)]);

function toSummary({ definition: _definition, ...summary }: WorkflowDTO): WorkflowSummaryDTO {
  return summary;
}

/** Role keys a definition names: steps, the planner and the roles a plan may use. */
function rolesOf({ definition }: WorkflowDTO): Set<string> {
  return new Set([
    ...definition.allowedRoles,
    ...(definition.plannerRole === undefined ? [] : [definition.plannerRole]),
    ...(definition.requiredSteps ?? []).map((s) => s.roleKey),
    ...(definition.template?.nodes ?? []).map((n) => n.roleKey),
  ]);
}

export function createWorkflowsService({ db, clock, log, roles }: WorkflowsServiceDeps) {
  const repo = createWorkflowsRepo(db);

  function get(id: string): WorkflowDTO {
    const workflow = repo.find(id);
    if (workflow === undefined) throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${id} not found`, { id });
    return workflow;
  }

  function latestByKey(key: string): WorkflowDTO {
    const workflow = repo.findLatest(key);
    if (workflow === undefined) throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${key} not found`, { key });
    return workflow;
  }

  const validate = (shape: WorkflowShape): ValidateWorkflowResponse => ({
    problems: validateWorkflowDefinition(shape, roles.list()),
  });

  function assertValid(shape: WorkflowShape): void {
    const { problems } = validate(shape);
    if (problems.length > 0) {
      throw new AppError(ErrorCode.WorkflowDefinitionInvalid, 'Workflow definition is invalid', { problems });
    }
  }

  function assertCustom(workflow: WorkflowDTO): void {
    if (workflow.kind === WorkflowKind.Builtin) {
      throw new AppError(
        ErrorCode.WorkflowReadonly,
        'Built-in workflows are read-only; copy the workflow to change it',
        {
          key: workflow.key,
        },
      );
    }
  }

  /** Stores a new latest version; numbering continues after any earlier version of the key (13 §5). */
  function insertVersion(content: VersionContent & { key: string }): WorkflowDTO {
    const [newest] = repo.listVersions(content.key);
    const workflow: WorkflowDTO = {
      ...content,
      id: randomUUID(),
      kind: WorkflowKind.Custom,
      version: (newest?.version ?? 0) + 1,
      createdAt: clock.now(),
    };
    db.transaction((tx) => createWorkflowsRepo(tx).insertLatest(workflow));
    log.info({ workflow: workflow.key, version: workflow.version }, 'workflow version added');
    return get(workflow.id);
  }

  return {
    list: (): WorkflowSummaryDTO[] => repo.listLatest().map(toSummary),
    get,
    versions(key: string): WorkflowSummaryDTO[] {
      const versions = repo.listVersions(key);
      if (versions.length === 0) throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${key} not found`, { key });
      return versions.map(toSummary);
    },
    validate,

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

    /** A new custom workflow, or a copy of a version (built-in ones included) under a new key (13 §5). */
    create({ key, name, copyFrom, ...fields }: CreateWorkflowRequest): WorkflowDTO {
      if (repo.findLatest(key) !== undefined) {
        throw new AppError(ErrorCode.WorkflowAlreadyExists, `Workflow ${key} already exists`, { key });
      }
      const source = copyFrom === undefined ? undefined : get(copyFrom);
      const { planning, deliverable, definition } = source ?? fields;
      // The request schema requires these without copyFrom.
      if (planning === undefined || deliverable === undefined || definition === undefined) {
        throw new Error('A new workflow without copyFrom passed validation incomplete');
      }
      assertValid({ planning, definition });
      return insertVersion({
        key,
        name,
        description: fields.description ?? source?.description ?? '',
        planning,
        deliverable,
        definition,
      });
    },

    /** A custom workflow is saved as a new version; running tasks keep the version they started with (13 §5). */
    update({ id, ...changes }: UpdateWorkflowRequest): WorkflowDTO {
      const current = get(id);
      assertCustom(current);
      const definition = changes.definition ?? current.definition;
      assertValid({ planning: current.planning, definition });
      return insertVersion({
        key: current.key,
        name: changes.name ?? current.name,
        description: changes.description ?? current.description,
        planning: current.planning,
        deliverable: current.deliverable,
        definition,
      });
    },

    /**
     * Deletes a custom workflow (11 §4): versions in `keep` (used by tasks) stay for them, unlisted; the others go.
     * The tasks module, which knows the tasks, decides `keep`.
     */
    remove(key: string, keep: (versionIds: string[]) => ReadonlySet<string>): void {
      assertCustom(latestByKey(key));
      const ids = repo.listVersions(key).map((v) => v.id);
      const kept = keep(ids);
      db.transaction((tx) => {
        const txRepo = createWorkflowsRepo(tx);
        txRepo.unlist(key);
        txRepo.delete(ids.filter((id) => !kept.has(id)));
      });
      log.info({ workflow: key, kept: kept.size }, 'workflow deleted');
    },

    /** Keys of the listed workflows whose latest version names the role (ROLE_IN_USE). */
    usingRole: (roleKey: string): string[] =>
      repo
        .listLatest()
        .filter((w) => rolesOf(w).has(roleKey))
        .map((w) => w.key),
  };
}
export type WorkflowsService = ReturnType<typeof createWorkflowsService>;
