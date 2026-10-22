import { type DiffFile, diffFileSchema, type GitFindingDTO, gitFindingSchema } from '@aw/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { gitReviewsTable } from './git-reviews.table.ts';

type ReviewRow = typeof gitReviewsTable.$inferSelect;

export type Review = Omit<ReviewRow, 'files' | 'findings'> & { files: DiffFile[]; findings: GitFindingDTO[] };

const filesSchema = z.array(diffFileSchema);
const findingsSchema = z.array(gitFindingSchema);

// JSON columns are parsed at the boundary (06 §9).
const toReview = ({ files, findings, ...row }: ReviewRow): Review => ({
  ...row,
  files: filesSchema.parse(JSON.parse(files)),
  findings: findings === null ? [] : findingsSchema.parse(JSON.parse(findings)),
});

export function createGitReviewsRepo(db: DbExecutor) {
  const r = gitReviewsTable;
  return {
    insert(review: Omit<Review, 'summary' | 'findings' | 'finishedAt'>): void {
      db.insert(r)
        .values({ ...review, files: JSON.stringify(review.files) })
        .run();
    },
    find(id: string): Review | undefined {
      const row = db.select().from(r).where(eq(r.id, id)).get();
      return row === undefined ? undefined : toReview(row);
    },
    findByAttempt(attemptId: string): Review | undefined {
      const row = db.select().from(r).where(eq(r.attemptId, attemptId)).get();
      return row === undefined ? undefined : toReview(row);
    },
    /** Newest first; `toSha` limits the list to reviews of one commit. */
    list(projectId: string, toSha?: string): Review[] {
      return db
        .select()
        .from(r)
        .where(and(eq(r.projectId, projectId), ...(toSha === undefined ? [] : [eq(r.toSha, toSha)])))
        .orderBy(desc(r.createdAt))
        .all()
        .map(toReview);
    },
    setResult(id: string, summary: string, findings: readonly GitFindingDTO[]): void {
      db.update(r)
        .set({ summary, findings: JSON.stringify(findings) })
        .where(eq(r.id, id))
        .run();
    },
    finish(id: string, finishedAt: number): void {
      db.update(r).set({ finishedAt }).where(eq(r.id, id)).run();
    },
    attemptIdsOf(projectId: string): string[] {
      return db
        .select({ attemptId: r.attemptId })
        .from(r)
        .where(eq(r.projectId, projectId))
        .all()
        .map((row) => row.attemptId);
    },
    deleteByProject(projectId: string): void {
      db.delete(r).where(eq(r.projectId, projectId)).run();
    },
  };
}
