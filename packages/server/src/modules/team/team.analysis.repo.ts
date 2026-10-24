import {
  type ErrorInfo,
  errorInfoSchema,
  type SubmitMemberAnalysisInput,
  submitMemberAnalysisInputSchema,
  type TeamAnalysisStatus,
} from '@aw/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import { teamAnalysesTable } from './team.table.ts';

export type SampledCommit = { sha: string; subject: string; lines: number };

export type Analysis = {
  id: string;
  projectId: string;
  memberEmail: string;
  ref: string;
  refSha: string;
  periodFrom: string;
  periodTo: string;
  status: TeamAnalysisStatus;
  commits: string[];
  sample: SampledCommit[];
  attemptId: string | null;
  report: SubmitMemberAnalysisInput | null;
  error: ErrorInfo | null;
  createdAt: number;
  finishedAt: number | null;
};

type Row = typeof teamAnalysesTable.$inferSelect;

const fromRow = (row: Row): Analysis => ({
  ...row,
  commits: JSON.parse(row.commits) as string[],
  sample: JSON.parse(row.sample) as SampledCommit[],
  report: row.report === null ? null : submitMemberAnalysisInputSchema.parse(JSON.parse(row.report)),
  error: row.error === null ? null : errorInfoSchema.parse(JSON.parse(row.error)),
});

/** 10 §team_analyses (33 §6). */
export function createAnalysesRepo(db: DbExecutor) {
  const t = teamAnalysesTable;
  return {
    insert(analysis: Analysis): void {
      db.insert(t)
        .values({
          ...analysis,
          commits: JSON.stringify(analysis.commits),
          sample: JSON.stringify(analysis.sample),
          report: null,
          error: null,
        })
        .run();
    },
    find(id: string): Analysis | undefined {
      const row = db.select().from(t).where(eq(t.id, id)).get();
      return row === undefined ? undefined : fromRow(row);
    },
    findByAttempt(attemptId: string): Analysis | undefined {
      const row = db.select().from(t).where(eq(t.attemptId, attemptId)).get();
      return row === undefined ? undefined : fromRow(row);
    },
    /** Newest first. */
    list(projectId: string, memberEmail?: string): Analysis[] {
      const where =
        memberEmail === undefined
          ? eq(t.projectId, projectId)
          : and(eq(t.projectId, projectId), eq(t.memberEmail, memberEmail));
      return db.select().from(t).where(where).orderBy(desc(t.createdAt), desc(sql`rowid`)).all().map(fromRow);
    },
    withStatus(statuses: readonly TeamAnalysisStatus[], projectId?: string): Analysis[] {
      const where =
        projectId === undefined
          ? inArray(t.status, statuses)
          : and(inArray(t.status, statuses), eq(t.projectId, projectId));
      // Analyses queued together share their time: the order they were asked for in decides.
      return db.select().from(t).where(where).orderBy(asc(t.createdAt), asc(sql`rowid`)).all().map(fromRow);
    },
    update(
      id: string,
      changes: Partial<Pick<Analysis, 'status' | 'attemptId' | 'report' | 'error' | 'finishedAt'>>,
    ): void {
      const { report, error, ...rest } = changes;
      db.update(t)
        .set({
          ...rest,
          ...(report === undefined ? {} : { report: report === null ? null : JSON.stringify(report) }),
          ...(error === undefined ? {} : { error: error === null ? null : JSON.stringify(error) }),
        })
        .where(eq(t.id, id))
        .run();
    },
  };
}
