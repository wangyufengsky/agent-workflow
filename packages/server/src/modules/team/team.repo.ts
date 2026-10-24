import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../core/db/database.ts';
import type { Identity, StoredCommit } from './team.aggregate.ts';
import type { CommitFacts, CommitFile } from './team.parse.ts';
import { teamCommitFilesTable, teamCommitsTable, teamIdentitiesTable, teamSettingsTable } from './team.table.ts';

/** SHAs per `IN (…)`, well under SQLite's variable limit. */
const SHAS_PER_QUERY = 900;
/** File rows per insert: five columns each, well under SQLite's variable limit. */
const FILE_ROWS_PER_INSERT = 2000;

export type StoredSettings = {
  excludeGlobs: string[] | null;
  testGlobs: string[] | null;
  hugeCommitLines: number | null;
};

/** The commit cache and the team settings of 33 §7, §8.2. */
export function createTeamRepo(db: DbExecutor) {
  const c = teamCommitsTable;
  const f = teamCommitFilesTable;

  return {
    /** Which of these commits are cached already. */
    cachedOf(projectId: string, shas: readonly string[]): Set<string> {
      const cached = new Set<string>();
      for (let i = 0; i < shas.length; i += SHAS_PER_QUERY) {
        const rows = db
          .select({ sha: c.sha })
          .from(c)
          .where(and(eq(c.projectId, projectId), inArray(c.sha, shas.slice(i, i + SHAS_PER_QUERY))))
          .all();
        for (const r of rows) cached.add(r.sha);
      }
      return cached;
    },

    /** Commits read once more by a second reading are already there and kept. */
    insertCommits(projectId: string, commits: CommitFacts[]): void {
      if (commits.length === 0) return;
      db.insert(c)
        .values(
          commits.map((commit) => ({
            projectId,
            sha: commit.sha,
            authorEmail: commit.authorEmail,
            authorName: commit.authorName,
            authoredAt: commit.authoredAt,
            subject: commit.subject,
            aiTask: commit.aiTask,
            aiCoauthor: commit.aiCoauthor,
            requestedByEmail: commit.requestedBy?.email ?? null,
            requestedByName: commit.requestedBy?.name ?? null,
            revertsSha: commit.revertsSha,
          })),
        )
        .onConflictDoNothing()
        .run();
      const files = commits.flatMap((commit) => commit.files.map((file) => ({ projectId, sha: commit.sha, ...file })));
      for (let i = 0; i < files.length; i += FILE_ROWS_PER_INSERT) {
        db.insert(f)
          .values(files.slice(i, i + FILE_ROWS_PER_INSERT))
          .onConflictDoNothing()
          .run();
      }
    },

    /** Commits authored in `[start, end)` with their files; whether a branch reaches them is the caller's question. */
    commitsIn(projectId: string, start: number, end: number): StoredCommit[] {
      const inRange = and(eq(c.projectId, projectId), gte(c.authoredAt, start), lt(c.authoredAt, end));
      const rows = db.select().from(c).where(inRange).all();
      const files = db
        .select({ sha: f.sha, path: f.path, added: f.added, deleted: f.deleted })
        .from(f)
        .innerJoin(c, and(eq(c.projectId, f.projectId), eq(c.sha, f.sha)))
        .where(inRange)
        .all();
      const bySha = new Map<string, CommitFile[]>();
      for (const { sha, ...file } of files) {
        const list = bySha.get(sha);
        if (list === undefined) bySha.set(sha, [file]);
        else list.push(file);
      }
      return rows.map((r) => ({
        sha: r.sha,
        authorEmail: r.authorEmail,
        authorName: r.authorName,
        authoredAt: r.authoredAt,
        subject: r.subject,
        aiTask: r.aiTask,
        aiCoauthor: r.aiCoauthor,
        requestedByEmail: r.requestedByEmail,
        requestedByName: r.requestedByName,
        files: bySha.get(r.sha) ?? [],
      }));
    },

    /** The paths a cached commit changed. */
    filesOf(projectId: string, sha: string): string[] {
      return db
        .select({ path: f.path })
        .from(f)
        .where(and(eq(f.projectId, projectId), eq(f.sha, sha)))
        .all()
        .map((r) => r.path);
    },

    /** Reverting commits and what they revert. */
    reverts(projectId: string): { sha: string; revertsSha: string }[] {
      return db
        .select({ sha: c.sha, revertsSha: c.revertsSha })
        .from(c)
        .where(and(eq(c.projectId, projectId), isNotNull(c.revertsSha)))
        .all()
        .flatMap((r) => (r.revertsSha === null ? [] : [{ sha: r.sha, revertsSha: r.revertsSha }]));
    },

    /** The newest author name of each email (D130 starters included). */
    authorNames(projectId: string, emails: string[]): Map<string, string> {
      if (emails.length === 0) return new Map();
      const rows = db
        .select({ email: c.authorEmail, name: c.authorName, at: sql<number>`max(${c.authoredAt})` })
        .from(c)
        .where(and(eq(c.projectId, projectId), inArray(c.authorEmail, emails)))
        .groupBy(c.authorEmail)
        .all();
      const starters = db
        .select({ email: c.requestedByEmail, name: c.requestedByName, at: sql<number>`max(${c.authoredAt})` })
        .from(c)
        .where(and(eq(c.projectId, projectId), inArray(c.requestedByEmail, emails)))
        .groupBy(c.requestedByEmail)
        .all();
      const names = new Map<string, { name: string; at: number }>();
      for (const r of [...rows, ...starters]) {
        if (r.email === null || r.name === null) continue;
        const known = names.get(r.email);
        if (known === undefined || r.at > known.at) names.set(r.email, { name: r.name, at: r.at });
      }
      return new Map([...names].map(([email, { name }]) => [email, name]));
    },

    identities(projectId: string): Identity[] {
      return db
        .select({
          email: teamIdentitiesTable.email,
          memberEmail: teamIdentitiesTable.memberEmail,
          displayName: teamIdentitiesTable.displayName,
          hidden: teamIdentitiesTable.hidden,
        })
        .from(teamIdentitiesTable)
        .where(eq(teamIdentitiesTable.projectId, projectId))
        .all();
    },

    upsertIdentity(projectId: string, identity: Identity): void {
      db.insert(teamIdentitiesTable)
        .values({ projectId, ...identity })
        .onConflictDoUpdate({
          target: [teamIdentitiesTable.projectId, teamIdentitiesTable.email],
          set: { memberEmail: identity.memberEmail, displayName: identity.displayName, hidden: identity.hidden },
        })
        .run();
    },

    settings(projectId: string): StoredSettings {
      const row = db.select().from(teamSettingsTable).where(eq(teamSettingsTable.projectId, projectId)).get();
      const list = (json: string | null | undefined) => (json == null ? null : (JSON.parse(json) as string[]));
      return {
        excludeGlobs: list(row?.excludeGlobs),
        testGlobs: list(row?.testGlobs),
        hugeCommitLines: row?.hugeCommitLines ?? null,
      };
    },

    saveSettings(projectId: string, settings: StoredSettings): void {
      const row = {
        excludeGlobs: settings.excludeGlobs === null ? null : JSON.stringify(settings.excludeGlobs),
        testGlobs: settings.testGlobs === null ? null : JSON.stringify(settings.testGlobs),
        hugeCommitLines: settings.hugeCommitLines,
      };
      db.insert(teamSettingsTable)
        .values({ projectId, ...row })
        .onConflictDoUpdate({ target: teamSettingsTable.projectId, set: row })
        .run();
    },
  };
}
export type TeamRepo = ReturnType<typeof createTeamRepo>;
