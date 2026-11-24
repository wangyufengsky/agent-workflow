import { randomUUID } from 'node:crypto';
import {
  APPROVER_ROLE_KEY,
  AppError,
  builtinSkillId,
  ErrorCode,
  type ProjectSkillBinding,
  SKILL_SELECTION_MAX,
  type SkillBindingScope,
  type UserSkillScope,
} from '@aw/shared';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { parseSkillMarkdown, snapshotSkill } from './skill-markdown.ts';
import { readBuiltinSkills } from './skills.catalog.ts';
import { createSkillsRepo, type SkillBindingRow } from './skills.repo.ts';

const workflowScopeKey = ({ projectId, workflowKey }: SkillBindingScope) => JSON.stringify([projectId, workflowKey]);
const toScope = ({ projectId, workflowKey, roleIds }: SkillBindingRow): SkillBindingScope => ({
  projectId,
  workflowKey,
  roleIds,
});

export function createSkillsService(deps: {
  db: Db;
  unit: UnitOfWork;
  projects: ProjectsService;
  workflows: WorkflowsService;
  roles: RolesService;
  skillsDir: string;
}) {
  const { db, unit, projects, workflows, roles, skillsDir } = deps;
  const repo = createSkillsRepo(db);
  const notFound = (id: string) => new AppError(ErrorCode.SkillNotFound, `Skill ${id} not found`, { id });
  const get = (id: string) => {
    const skill = repo.find(id);
    if (skill === undefined) throw notFound(id);
    return skill;
  };
  const selected = (ids: string[]) => {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const records = new Map(repo.many(unique).map((skill) => [skill.id, skill]));
    return unique.map((id) => {
      const skill = records.get(id);
      if (skill === undefined) throw notFound(id);
      return skill;
    });
  };
  const content = (source: string, id: string) => {
    const header = parseSkillMarkdown(source);
    const taken = repo.byName(header.name);
    if (taken !== undefined && taken.id !== id) {
      throw new AppError(ErrorCode.SkillNameTaken, `Skill name ${header.name} already exists`);
    }
    return { id, ...header, source };
  };

  function bindings(projectId: string): ProjectSkillBinding[] {
    projects.getRecord(projectId);
    const byWorkflow = Map.groupBy(repo.projectBindings(projectId), ({ workflowKey }) => workflowKey);
    return Array.from(byWorkflow, ([workflowKey, rows]) => ({
      projectId,
      workflowKey,
      skillIds: rows.map(({ skillId }) => skillId),
    }));
  }

  function validateScopes(scopes: SkillBindingScope[]) {
    const workflowKeys = new Set(workflows.list().map(({ key }) => key));
    const roleIds = new Set(
      roles
        .list()
        .filter((r) => r.key !== APPROVER_ROLE_KEY)
        .map(({ id }) => id),
    );
    const projectIds = new Set(projects.list().map(({ id }) => id));
    const seen = new Set<string>();
    for (const scope of scopes) {
      const key = workflowScopeKey(scope);
      if (seen.has(key))
        throw new AppError(ErrorCode.ValidationFailed, 'A workflow can only be bound once per project');
      seen.add(key);
      if (!projectIds.has(scope.projectId)) {
        throw new AppError(ErrorCode.ProjectNotFound, `Project ${scope.projectId} not found`, { id: scope.projectId });
      }
      if (!workflowKeys.has(scope.workflowKey)) {
        throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${scope.workflowKey} not found`, {
          key: scope.workflowKey,
        });
      }
      const missing = scope.roleIds?.find((id) => !roleIds.has(id));
      if (missing !== undefined)
        throw new AppError(ErrorCode.RoleNotFound, `Role ${missing} not found`, { id: missing });
    }
  }

  function setScope({ id, assistantEnabled, bindings }: UserSkillScope): UserSkillScope {
    return unit.transact(() => {
      get(id);
      validateScopes(bindings);
      const byWorkflow = Map.groupBy(repo.allBindings(), (binding) => workflowScopeKey(binding));
      const next = bindings.map((scope) => {
        const rows = byWorkflow.get(workflowScopeKey(scope)) ?? [];
        const current = rows.find(({ skillId }) => skillId === id);
        if (current === undefined && rows.length >= SKILL_SELECTION_MAX) {
          throw new AppError(ErrorCode.SkillBindingLimit, 'Workflow already has the maximum skills', {
            projectId: scope.projectId,
            workflowKey: scope.workflowKey,
          });
        }
        return {
          ...scope,
          skillId: id,
          position: current?.position ?? (rows.at(-1)?.position ?? -1) + 1,
          roleIds: scope.roleIds === null ? null : [...new Set(scope.roleIds)],
        };
      });
      repo.replaceSkillBindings(id, next);
      repo.setAssistantEnabled(id, assistantEnabled);
      return { id, assistantEnabled, bindings: next.map(toScope) };
    });
  }

  let builtin: ReturnType<typeof readBuiltinSkills> | undefined;
  return {
    list: () => repo.list(),
    catalog() {
      const bySkill = Map.groupBy(repo.allBindings(), ({ skillId }) => skillId);
      builtin ??= readBuiltinSkills(skillsDir);
      return {
        builtin,
        scopes: repo.list().map(({ id, assistantEnabled }) => ({
          id,
          assistantEnabled,
          bindings: (bySkill.get(id) ?? []).map(toScope),
        })),
      };
    },
    create: (source: string) =>
      unit.transact(() => {
        const skill = { ...content(source, randomUUID()), version: 1, assistantEnabled: true };
        repo.insert(skill);
        return skill;
      }),
    update: (id: string, source: string) =>
      unit.transact(() => {
        const previous = get(id);
        if (source === previous.source) return previous;
        const skill = { ...previous, ...content(source, id), version: previous.version + 1 };
        repo.update(skill);
        return skill;
      }),
    remove(id: string) {
      get(id);
      repo.remove(id);
    },
    bindings,
    setScope,
    bind: ({ projectId, workflowKey, skillIds }: ProjectSkillBinding) =>
      unit.transact(() => {
        projects.getRecord(projectId);
        if (!workflows.list().some((workflow) => workflow.key === workflowKey)) {
          throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${workflowKey} not found`, { key: workflowKey });
        }
        const ids = selected(skillIds).map(({ id }) => id);
        const previous = new Map(
          repo.workflowBindings(projectId, workflowKey).map((row) => [row.skillId, row.roleIds]),
        );
        repo.replaceWorkflowBindings(
          projectId,
          workflowKey,
          ids.map((skillId, position) => ({
            projectId,
            workflowKey,
            skillId,
            position,
            roleIds: previous.get(skillId) ?? null,
          })),
        );
        return { projectId, workflowKey, skillIds: ids };
      }),
    selected: (ids: string[]) =>
      [...new Set(ids)].map((id) => {
        if (id.startsWith('builtin:')) {
          builtin ??= readBuiltinSkills(skillsDir);
          const definition = builtin.find((s) => builtinSkillId(s.name) === id);
          if (!definition) throw notFound(id);
          if (!definition.assistantEnabled)
            throw new AppError(ErrorCode.SkillAssistantDisabled, 'Skill is disabled for the assistant', { id });
          return snapshotSkill({ ...definition, id, version: 1 });
        }
        const skill = get(id);
        if (!skill.assistantEnabled) {
          throw new AppError(ErrorCode.SkillAssistantDisabled, 'Skill is disabled for the assistant', { id: skill.id });
        }
        return snapshotSkill(skill);
      }),
    forWorkflow: (projectId: string, workflowKey: string) =>
      repo.boundSkills(projectId, workflowKey).map(({ skill, roleIds }) => ({ ...snapshotSkill(skill), roleIds })),
    releaseWorkflow: (workflowKey: string) => {
      repo.releaseWorkflow(workflowKey);
    },
    releaseRole: (roleId: string) => {
      for (const binding of repo.allBindings()) {
        if (binding.roleIds?.includes(roleId)) {
          repo.setBindingRoles(
            binding,
            binding.roleIds.filter((id) => id !== roleId),
          );
        }
      }
    },
  };
}
export type SkillsService = ReturnType<typeof createSkillsService>;
