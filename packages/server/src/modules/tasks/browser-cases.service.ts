import { randomUUID } from 'node:crypto';
import { AppError, type BrowserCaseInput, browserCaseInputSchema, ErrorCode } from '@aw/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../core/db/database.ts';
import type { ProjectsService } from '../projects/index.ts';
import { browserCasesTable as cases } from './browser-cases.table.ts';

function fromRow({ caseId, revision, definition }: typeof cases.$inferSelect) {
  return { caseId, revision, ...browserCaseInputSchema.parse(JSON.parse(definition)) };
}

export function createBrowserCases(db: Db, projects: ProjectsService) {
  const key = (projectId: string, caseId: string) => and(eq(cases.projectId, projectId), eq(cases.caseId, caseId));

  function revisionOf(projectId: string, caseId: string, revision: number) {
    const row = db.select().from(cases).where(key(projectId, caseId)).get();
    if (row === undefined) throw new AppError(ErrorCode.NotFound, 'Browser case not found');
    if (row.revision !== revision) throw new AppError(ErrorCode.BrowserCaseChanged, 'Browser case revision changed');
    return fromRow(row);
  }

  return {
    list(projectId: string) {
      projects.getRecord(projectId);
      return db.select().from(cases).where(eq(cases.projectId, projectId)).all().map(fromRow);
    },
    create(projectId: string, definition: BrowserCaseInput) {
      projects.getRecord(projectId);
      const row = { projectId, caseId: randomUUID(), revision: 1, definition: JSON.stringify(definition) };
      db.insert(cases).values(row).run();
      return { caseId: row.caseId, revision: row.revision, ...definition };
    },
    update(projectId: string, caseId: string, revision: number, definition: BrowserCaseInput) {
      const row = db
        .update(cases)
        .set({ definition: JSON.stringify(definition), revision: revision + 1 })
        .where(and(key(projectId, caseId), eq(cases.revision, revision)))
        .returning()
        .get();
      if (row === undefined) throw new AppError(ErrorCode.BrowserCaseChanged, 'Browser case revision changed');
      return fromRow(row);
    },
    revision: revisionOf,
  };
}
