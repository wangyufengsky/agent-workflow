import type { UserSkillDTO } from '@aw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectSkillBindingsTable as bindings, userSkillsTable as skills } from './skills.table.ts';

export function createSkillsRepo(db: DbExecutor) {
  const byProjectWorkflow = (projectId: string, workflowKey: string) =>
    and(eq(bindings.projectId, projectId), eq(bindings.workflowKey, workflowKey));

  return {
    list: () => db.select().from(skills).orderBy(skills.name).all(),
    find: (id: string) => db.select().from(skills).where(eq(skills.id, id)).get(),
    byName: (name: string) => db.select().from(skills).where(eq(skills.name, name)).get(),
    many: (ids: string[]) => db.select().from(skills).where(inArray(skills.id, ids)).all(),
    insert: (skill: UserSkillDTO) => db.insert(skills).values(skill).run(),
    update: ({ id, ...values }: UserSkillDTO) => db.update(skills).set(values).where(eq(skills.id, id)).run(),
    remove: (id: string) => db.delete(skills).where(eq(skills.id, id)).run(),
    projectBindings: (projectId: string) =>
      db
        .select()
        .from(bindings)
        .where(eq(bindings.projectId, projectId))
        .orderBy(bindings.workflowKey, bindings.position)
        .all(),
    boundSkills: (projectId: string, workflowKey: string) =>
      db
        .select({ skill: skills })
        .from(bindings)
        .innerJoin(skills, eq(skills.id, bindings.skillId))
        .where(byProjectWorkflow(projectId, workflowKey))
        .orderBy(bindings.position)
        .all()
        .map(({ skill }) => skill),
    replaceBindings(projectId: string, workflowKey: string, ids: string[]) {
      db.delete(bindings).where(byProjectWorkflow(projectId, workflowKey)).run();
      if (ids.length > 0) {
        db.insert(bindings)
          .values(ids.map((skillId, position) => ({ projectId, workflowKey, skillId, position })))
          .run();
      }
    },
    releaseWorkflow: (workflowKey: string) => db.delete(bindings).where(eq(bindings.workflowKey, workflowKey)).run(),
  };
}
