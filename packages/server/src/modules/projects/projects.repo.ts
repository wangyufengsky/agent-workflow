import type { ProjectDTO } from '@aw/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectsTable } from './projects.table.ts';

type ProjectRow = typeof projectsTable.$inferSelect;
export type NewProject = Omit<ProjectRow, 'hostingProvider' | 'hostingBaseUrl' | 'hostingRepo' | 'hostingCredentialId'>;
/** Undefined fields are left unchanged. */
export type ProjectChanges = { [K in 'name' | 'defaultBranch' | 'checkCommand']?: ProjectRow[K] | undefined } & {
  updatedAt: number;
};

function toProject(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    checkCommand: row.checkCommand,
    hosting:
      row.hostingProvider === null || row.hostingRepo === null
        ? null
        : {
            provider: row.hostingProvider,
            baseUrl: row.hostingBaseUrl,
            repo: row.hostingRepo,
            hasToken: row.hostingCredentialId !== null,
          },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createProjectsRepo(db: DbExecutor) {
  return {
    list(): ProjectDTO[] {
      return db.select().from(projectsTable).orderBy(asc(projectsTable.createdAt)).all().map(toProject);
    },
    find(id: string): ProjectDTO | undefined {
      const row = db.select().from(projectsTable).where(eq(projectsTable.id, id)).get();
      return row === undefined ? undefined : toProject(row);
    },
    findByRepoPath(repoPath: string): ProjectDTO | undefined {
      const row = db.select().from(projectsTable).where(eq(projectsTable.repoPath, repoPath)).get();
      return row === undefined ? undefined : toProject(row);
    },
    slugs(): Set<string> {
      return new Set(
        db
          .select({ slug: projectsTable.slug })
          .from(projectsTable)
          .all()
          .map((r) => r.slug),
      );
    },
    insert(project: NewProject): void {
      db.insert(projectsTable).values(project).run();
    },
    update(id: string, changes: ProjectChanges): void {
      db.update(projectsTable).set(changes).where(eq(projectsTable.id, id)).run();
    },
    delete(id: string): void {
      db.delete(projectsTable).where(eq(projectsTable.id, id)).run();
    },
  };
}
