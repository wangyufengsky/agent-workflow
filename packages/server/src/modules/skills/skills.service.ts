import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, type ProjectSkillBinding, type UserSkillDTO } from '@aw/shared';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';
import { parseSkillMarkdown, snapshotSkill } from './skill-markdown.ts';
import { createSkillsRepo } from './skills.repo.ts';

export function createSkillsService(deps: {
  db: Db;
  unit: UnitOfWork;
  projects: ProjectsService;
  workflows: WorkflowsService;
}) {
  const { db, unit, projects, workflows } = deps;
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
  const bindings = (projectId: string): ProjectSkillBinding[] => {
    projects.getRecord(projectId);
    const byWorkflow = new Map<string, ProjectSkillBinding>();
    for (const { workflowKey, skillId } of repo.projectBindings(projectId)) {
      const binding = byWorkflow.get(workflowKey) ?? { projectId, workflowKey, skillIds: [] };
      binding.skillIds.push(skillId);
      byWorkflow.set(workflowKey, binding);
    }
    return [...byWorkflow.values()];
  };
  return {
    list: () => repo.list(),
    create: (source: string) =>
      unit.transact(() => {
        const skill = { ...content(source, randomUUID()), version: 1 };
        repo.insert(skill);
        return skill;
      }),
    update: (id: string, source: string) =>
      unit.transact(() => {
        const previous = get(id);
        if (source === previous.source) return previous;
        const skill: UserSkillDTO = { ...content(source, id), version: previous.version + 1 };
        repo.update(skill);
        return skill;
      }),
    remove(id: string) {
      get(id);
      repo.remove(id);
    },
    bindings,
    bind: ({ projectId, workflowKey, skillIds }: ProjectSkillBinding) =>
      unit.transact(() => {
        projects.getRecord(projectId);
        if (!workflows.list().some((workflow) => workflow.key === workflowKey)) {
          throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${workflowKey} not found`, { key: workflowKey });
        }
        const ids = selected(skillIds).map(({ id }) => id);
        repo.replaceBindings(projectId, workflowKey, ids);
        return { projectId, workflowKey, skillIds: ids };
      }),
    selected: (ids: string[]) => selected(ids).map(snapshotSkill),
    forWorkflow: (projectId: string, workflowKey: string) =>
      repo.boundSkills(projectId, workflowKey).map(snapshotSkill),
    releaseWorkflow: (workflowKey: string) => {
      repo.releaseWorkflow(workflowKey);
    },
  };
}
export type SkillsService = ReturnType<typeof createSkillsService>;
