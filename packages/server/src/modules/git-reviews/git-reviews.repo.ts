import {
  DesignKnowledgeMatch,
  diffFileSchema,
  type GitComparisonDTO,
  type GitFindingDTO,
  type GitFindingInput,
  GitFindingStatus,
  type GitImpactItemDTO,
  gitComparisonSchema,
  gitFindingSchema,
  gitReviewImpactsSchema,
  gitReviewRegressionChecksSchema,
} from '@aw/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from '../../core/db/database.ts';
import { gitReviewsTable } from './git-reviews.table.ts';

type ReviewRow = typeof gitReviewsTable.$inferSelect;

const filesSchema = z.array(
  diffFileSchema.extend({ worktreeHash: z.string().optional(), designUncovered: z.array(z.string()).optional() }),
);
const findingsSchema = z.array(gitFindingSchema.partial({ id: true, status: true }));

export type Review = Omit<
  ReviewRow,
  'files' | 'findings' | 'impacts' | 'regressionChecks' | 'designMatch' | 'impactTruncated' | 'comparison'
> & {
  files: z.infer<typeof filesSchema>;
  findings: GitFindingDTO[];
  impacts: GitImpactItemDTO[];
  regressionChecks: string[];
  comparison?: GitComparisonDTO | undefined;
  designMatch: DesignKnowledgeMatch;
  impactTruncated: boolean;
};

type NewReview = Omit<Review, 'summary' | 'findings' | 'impacts' | 'regressionChecks' | 'finishedAt' | DesignMetadata> &
  Partial<Pick<Review, DesignMetadata>>;
type DesignMetadata = 'designId' | 'designSnapshotSha' | 'designMatch' | 'impactTruncated';

const findingId = (index: number): string => `finding-${index + 1}`;

// JSON columns are parsed at the boundary (06 §9).
function toReview({ files, findings, impacts, regressionChecks, comparison, ...row }: ReviewRow): Review {
  return {
    ...row,
    files: filesSchema.parse(JSON.parse(files)),
    // 旧报告按存储顺序补全问题 ID，人工更新时会一并写回所有 ID。
    findings:
      findings === null
        ? []
        : findingsSchema.parse(JSON.parse(findings)).map((finding, index) => ({
            ...finding,
            id: finding.id ?? findingId(index),
            status: finding.status ?? GitFindingStatus.Open,
          })),
    impacts: impacts === null ? [] : gitReviewImpactsSchema.parse(JSON.parse(impacts)),
    regressionChecks:
      regressionChecks === null ? [] : gitReviewRegressionChecksSchema.parse(JSON.parse(regressionChecks)),
    ...(comparison === null ? {} : { comparison: gitComparisonSchema.parse(JSON.parse(comparison)) }),
    designMatch: row.designMatch ?? DesignKnowledgeMatch.Missing,
    impactTruncated: row.impactTruncated ?? false,
  };
}

export function createGitReviewsRepo(db: DbExecutor) {
  const r = gitReviewsTable;
  return {
    insert({ designMatch, comparison, ...review }: NewReview): void {
      db.insert(r)
        .values({
          ...review,
          designMatch: designMatch === undefined || designMatch === DesignKnowledgeMatch.Missing ? null : designMatch,
          files: JSON.stringify(review.files),
          comparison: comparison === undefined ? null : JSON.stringify(comparison),
        })
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
    setResult(
      id: string,
      summary: string,
      findings: readonly GitFindingInput[],
      impacts?: readonly GitImpactItemDTO[],
      regressionChecks?: readonly string[],
      comparison?: GitComparisonDTO,
    ): void {
      const newFindings = findings.map((finding, index) => ({
        ...finding,
        id: findingId(index),
        status: GitFindingStatus.Open,
      }));
      db.update(r)
        .set({
          summary,
          findings: JSON.stringify(newFindings),
          impacts: impacts === undefined ? null : JSON.stringify(impacts),
          regressionChecks: regressionChecks === undefined ? null : JSON.stringify(regressionChecks),
          ...(comparison === undefined ? {} : { comparison: JSON.stringify(comparison) }),
        })
        .where(eq(r.id, id))
        .run();
    },
    updateFindingStatus(id: string, findingId: string, status: GitFindingStatus): Review | undefined {
      const row = db.select().from(r).where(eq(r.id, id)).get();
      if (row === undefined) return undefined;
      const review = toReview(row);
      const finding = review.findings.find((item) => item.id === findingId);
      if (finding === undefined) return undefined;
      finding.status = status;
      db.update(r)
        .set({ findings: JSON.stringify(review.findings) })
        .where(eq(r.id, id))
        .run();
      return review;
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
