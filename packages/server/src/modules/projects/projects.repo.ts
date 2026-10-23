import { type HostingRef, type ProjectDTO, type ProjectPreview, projectPreviewSchema } from '@aw/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { projectBashRulesTable, projectsTable } from './projects.table.ts';

type ProjectRow = typeof projectsTable.$inferSelect;
export type NewProject = Omit<ProjectRow, 'hostingProvider' | 'hostingBaseUrl' | 'hostingRepo' | 'hostingCredentialId'>;
/** Undefined fields are left unchanged. */
export type ProjectChanges = { [K in 'name' | 'defaultBranch' | 'checkCommand']?: ProjectRow[K] | undefined } & {
  preview?: ProjectPreview | null | undefined;
  updatedAt: number;
};

/** The column is a boundary (06 §1): parsed, never trusted. */
function previewOf(json: string | null): ProjectPreview | null {
  return json === null ? null : projectPreviewSchema.parse(JSON.parse(json));
}

function previewJson(preview: ProjectPreview | null): string | null {
  return preview === null ? null : JSON.stringify(preview);
}

/** A bound remote, or null to unbind. */
export type ProjectHosting = (HostingRef & { credentialId: string }) | null;

function toProject(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    checkCommand: row.checkCommand,
    preview: previewOf(row.preview),
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
    insert({ preview, ...project }: Omit<NewProject, 'preview'> & { preview: ProjectPreview | null }): void {
      db.insert(projectsTable)
        .values({ ...project, preview: previewJson(preview) })
        .run();
    },
    hostingCredentialId(id: string): string | null {
      const row = db
        .select({ id: projectsTable.hostingCredentialId })
        .from(projectsTable)
        .where(eq(projectsTable.id, id))
        .get();
      return row?.id ?? null;
    },
    setHosting(id: string, hosting: ProjectHosting, updatedAt: number): void {
      db.update(projectsTable)
        .set({
          hostingProvider: hosting?.provider ?? null,
          hostingBaseUrl: hosting?.baseUrl ?? null,
          hostingRepo: hosting?.repo ?? null,
          hostingCredentialId: hosting?.credentialId ?? null,
          updatedAt,
        })
        .where(eq(projectsTable.id, id))
        .run();
    },
    update(id: string, { preview, ...changes }: ProjectChanges): void {
      db.update(projectsTable)
        .set({ ...changes, ...(preview === undefined ? {} : { preview: previewJson(preview) }) })
        .where(eq(projectsTable.id, id))
        .run();
    },
    delete(id: string): void {
      db.delete(projectsTable).where(eq(projectsTable.id, id)).run();
    },
    allowedBash(projectId: string): string[] {
      const rules = projectBashRulesTable;
      return db
        .select({ pattern: rules.pattern })
        .from(rules)
        .where(eq(rules.projectId, projectId))
        .orderBy(asc(rules.createdAt), asc(rules.pattern))
        .all()
        .map((r) => r.pattern);
    },
    /** Patterns already allowed keep their first time. */
    addAllowedBash(projectId: string, patterns: readonly string[], createdAt: number): void {
      if (patterns.length === 0) return;
      db.insert(projectBashRulesTable)
        .values(patterns.map((pattern) => ({ projectId, pattern, createdAt })))
        .onConflictDoNothing()
        .run();
    },
    removeAllowedBash(projectId: string, pattern: string): void {
      const rules = projectBashRulesTable;
      db.delete(rules)
        .where(and(eq(rules.projectId, projectId), eq(rules.pattern, pattern)))
        .run();
    },
  };
}
