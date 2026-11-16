import { skillBindingScopeSchema, type UserSkillDTO } from '@aw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectSkillBindingsTable as bindings, userSkillsTable as skills } from './skills.table.ts';

type BindingRow = typeof bindings.$inferSelect;
export type SkillBindingRow = Omit<BindingRow, 'roleIds'> & { roleIds: string[] | null };
const bindingOf = ({ roleIds, ...row }: BindingRow): SkillBindingRow => ({
  ...row,
  roleIds: roleIds === null ? null : skillBindingScopeSchema.shape.roleIds.parse(JSON.parse(roleIds)),
});
const whereBinding = ({
  projectId,
  workflowKey,
  skillId,
}: Pick<SkillBindingRow, 'projectId' | 'workflowKey' | 'skillId'>) =>
  and(eq(bindings.projectId, projectId), eq(bindings.workflowKey, workflowKey), eq(bindings.skillId, skillId));

export function createSkillsRepo(db: DbExecutor) {
  const byProjectWorkflow = (projectId: string, workflowKey: string) =>
    and(eq(bindings.projectId, projectId), eq(bindings.workflowKey, workflowKey));

  function insertBindings(rows: SkillBindingRow[]) {
    if (rows.length === 0) return;
    db.insert(bindings)
      .values(
        rows.map(({ roleIds, ...row }) => ({
          ...row,
          roleIds: roleIds === null ? null : JSON.stringify(roleIds),
        })),
      )
      .run();
  }

  return {
    list: () => db.select().from(skills).orderBy(skills.name).all(),
    find: (id: string) => db.select().from(skills).where(eq(skills.id, id)).get(),
    byName: (name: string) => db.select().from(skills).where(eq(skills.name, name)).get(),
    many: (ids: string[]) => db.select().from(skills).where(inArray(skills.id, ids)).all(),
    insert: (skill: UserSkillDTO) => db.insert(skills).values(skill).run(),
    update: ({ id, ...values }: UserSkillDTO) => db.update(skills).set(values).where(eq(skills.id, id)).run(),
    setAssistantEnabled: (id: string, assistantEnabled: boolean) =>
      db.update(skills).set({ assistantEnabled }).where(eq(skills.id, id)).run(),
    remove: (id: string) => db.delete(skills).where(eq(skills.id, id)).run(),
    allBindings: () =>
      db
        .select()
        .from(bindings)
        .orderBy(bindings.projectId, bindings.workflowKey, bindings.position)
        .all()
        .map(bindingOf),
    projectBindings: (projectId: string) =>
      db
        .select()
        .from(bindings)
        .where(eq(bindings.projectId, projectId))
        .orderBy(bindings.workflowKey, bindings.position)
        .all()
        .map(bindingOf),
    workflowBindings: (projectId: string, workflowKey: string) =>
      db
        .select()
        .from(bindings)
        .where(byProjectWorkflow(projectId, workflowKey))
        .orderBy(bindings.position)
        .all()
        .map(bindingOf),
    boundSkills: (projectId: string, workflowKey: string) =>
      db
        .select({ skill: skills, binding: bindings })
        .from(bindings)
        .innerJoin(skills, eq(skills.id, bindings.skillId))
        .where(byProjectWorkflow(projectId, workflowKey))
        .orderBy(bindings.position)
        .all()
        .map(({ skill, binding }) => ({ skill, roleIds: bindingOf(binding).roleIds })),
    replaceWorkflowBindings(projectId: string, workflowKey: string, rows: SkillBindingRow[]) {
      db.delete(bindings).where(byProjectWorkflow(projectId, workflowKey)).run();
      insertBindings(rows);
    },
    replaceSkillBindings(skillId: string, rows: SkillBindingRow[]) {
      db.delete(bindings).where(eq(bindings.skillId, skillId)).run();
      insertBindings(rows);
    },
    setBindingRoles(binding: SkillBindingRow, roleIds: string[]) {
      const where = whereBinding(binding);
      if (roleIds.length === 0) db.delete(bindings).where(where).run();
      else
        db.update(bindings)
          .set({ roleIds: JSON.stringify(roleIds) })
          .where(where)
          .run();
    },
    releaseWorkflow: (workflowKey: string) => db.delete(bindings).where(eq(bindings.workflowKey, workflowKey)).run(),
  };
}
