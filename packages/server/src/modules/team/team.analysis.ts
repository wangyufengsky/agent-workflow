import { randomUUID } from 'node:crypto';
import { BuiltinRoleKey, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  DiffSide,
  ErrorCode,
  type ErrorInfo,
  ServerEventType,
  SessionAgent,
  type SubmitMemberAnalysisInput,
  TEAM_ANALYSIS_COMMITS_MAX,
  TEAM_ANALYSIS_PROBLEM_HINT,
  TEAM_ANALYSIS_SAMPLE,
  TEAM_REVIEW_MAX_LINES,
  type TeamAnalysisDTO,
  TeamAnalysisEvent,
  TeamAnalysisProblemCode,
  type TeamAnalysisQualityDTO,
  TeamAnalysisStatus,
  type TeamMetricsDTO,
  type TeamQuery,
  teamAnalysisMachine,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { CountedCommit } from './team.aggregate.ts';
import { type Analysis, createAnalysesRepo, type SampledCommit } from './team.analysis.repo.ts';
import { lineCountAt } from './team.scan.ts';

/** One member's commits of a range, as the team figures count them. */
export type MemberWork = {
  key: string;
  name: string;
  emails: string[];
  commits: CountedCommit[];
  metrics: TeamMetricsDTO;
};

export type RangeWork = {
  project: { id: string; name: string; repoPath: string };
  ref: string;
  tipSha: string;
  from: string;
  to: string;
  members: MemberWork[];
};

export type TeamAnalysesDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  attempts: AttemptsService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
  /** The members' commits of the query's range (the team service's figures). */
  work(query: TeamQuery, members: readonly string[]): Promise<RangeWork>;
  /** The changed files of a commit, from the commit cache. */
  filesOf(projectId: string, sha: string): string[];
  repoPathOf(projectId: string): string;
};

const ACTIVE: readonly TeamAnalysisStatus[] = [TeamAnalysisStatus.Queued, TeamAnalysisStatus.Running];
const SESSION_TITLE_PREFIX = 'Team';

/** The largest commits that are small enough to review (33 §6.2). */
export function sampleOf(commits: readonly CountedCommit[]): SampledCommit[] {
  return commits
    .map((c) => ({ sha: c.sha, subject: c.subject, lines: c.added + c.deleted, huge: c.huge }))
    .filter((c) => !c.huge && c.lines > 0 && c.lines <= TEAM_REVIEW_MAX_LINES)
    .sort((x, y) => y.lines - x.lines)
    .slice(0, TEAM_ANALYSIS_SAMPLE)
    .map(({ sha, subject, lines }) => ({ sha, subject, lines }));
}

/** Findings per thousand reviewed lines (33 §6.5). */
export function qualityOf(analysis: Pick<Analysis, 'sample' | 'report'>): TeamAnalysisQualityDTO | null {
  if (analysis.report === null) return null;
  const sampledLines = analysis.sample.reduce((n, s) => n + s.lines, 0);
  const count = (severity: string) => analysis.report?.findings.filter((f) => f.severity === severity).length ?? 0;
  const [blocker, major, minor] = [count('blocker'), count('major'), count('minor')];
  const per = (n: number) => (n * 1000) / sampledLines;
  return {
    sampledLines,
    blocker,
    major,
    minor,
    perKloc: sampledLines === 0 ? null : { blocker: per(blocker), major: per(major), minor: per(minor) },
  };
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function firstMessage(prompts: Prompts, work: RangeWork, member: MemberWork, sample: SampledCommit[]): string {
  const newest = [...member.commits].sort((x, y) => y.authoredAt - x.authoredAt);
  const listed = newest
    .slice(0, TEAM_ANALYSIS_COMMITS_MAX)
    .map((c) => `- ${c.sha} ${day(c.authoredAt)} +${c.added} −${c.deleted} ${c.subject}`);
  const more = newest.length - listed.length;
  const m = member.metrics;
  return renderTemplate(prompts[PromptName.StartTeamAnalysis], {
    projectName: work.project.name,
    memberName: member.name,
    emails: member.emails.join(', '),
    ref: work.ref,
    from: work.from,
    to: work.to,
    figures: [
      `- Commits: ${m.commits} on ${m.activeDays} days`,
      `- Counted lines: +${m.added} −${m.deleted} in ${m.files} files (lock files, build output and huge commits left out)`,
      `- Commits changing code that also change tests: ${m.testCommits} of ${m.codeCommits}`,
      `- Later reverted: ${m.reverted}`,
    ].join('\n'),
    commits: [...listed, ...(more > 0 ? [`- … and ${more} older commits, not listed`] : [])].join('\n'),
    sample:
      sample.length === 0
        ? 'None: no commit is small enough to review. Write the summary only, with no findings.'
        : sample.map((s) => `- ${s.sha} (${s.lines} lines) ${s.subject}`).join('\n'),
  });
}

/** AI member analyses (33 §6, D131): queued per project, one session at a time, no score. */
export function createTeamAnalyses(deps: TeamAnalysesDeps) {
  const { unit, clock, log, attempts, roles, settings, prompts } = deps;
  const repo = createAnalysesRepo(deps.db);

  function mustFind(id: string): Analysis {
    const analysis = repo.find(id);
    if (analysis === undefined) throw new AppError(ErrorCode.TeamAnalysisNotFound, `No analysis ${id}`, { id });
    return analysis;
  }

  function toDto(analysis: Analysis): TeamAnalysisDTO {
    return {
      id: analysis.id,
      projectId: analysis.projectId,
      member: analysis.memberEmail,
      ref: analysis.ref,
      refSha: analysis.refSha,
      from: analysis.periodFrom,
      to: analysis.periodTo,
      status: analysis.status,
      attemptId: analysis.attemptId,
      error: analysis.error,
      sample: analysis.sample,
      report: analysis.report,
      quality: qualityOf(analysis),
      createdAt: analysis.createdAt,
      finishedAt: analysis.finishedAt,
    };
  }

  /** Moves an analysis through its machine (09) and tells the page. */
  function move(
    analysis: Analysis,
    event: TeamAnalysisEvent,
    changes: Partial<Pick<Analysis, 'attemptId' | 'report' | 'error'>> = {},
  ): void {
    const status = transition(teamAnalysisMachine, analysis.status, event);
    const ended = !ACTIVE.includes(status);
    repo.update(analysis.id, { ...changes, status, ...(ended ? { finishedAt: clock.now() } : {}) });
    unit.publish({
      type: ServerEventType.TeamAnalysisUpdated,
      data: { projectId: analysis.projectId, analysisId: analysis.id },
    });
  }

  /** The first message of each queued analysis; kept in memory, as the queue does not outlive the app (recover). */
  const firstMessages = new Map<string, { directory: string; prompt: string }>();

  /** Starts the project's next queued analysis when none runs. */
  function pump(projectId: string): void {
    if (repo.withStatus([TeamAnalysisStatus.Running], projectId).length > 0) return;
    const next = repo.withStatus([TeamAnalysisStatus.Queued], projectId)[0];
    if (next === undefined) return;
    const message = firstMessages.get(next.id);
    if (message === undefined) {
      // Queued in an earlier run of the app; its first message went with it (recover() ends those).
      unit.transact(() => move(next, TeamAnalysisEvent.Fail, { error: interrupted() }));
      pump(projectId);
      return;
    }
    const reviewer = roles.getByKey(BuiltinRoleKey.Reviewer);
    const attemptId = randomUUID();
    unit.transact(() => move(next, TeamAnalysisEvent.Start, { attemptId }));
    firstMessages.delete(next.id);
    attempts
      .start({
        id: attemptId,
        kind: AttemptKind.TeamAnalysis,
        agent: SessionAgent.CodeReviewer,
        projectId,
        taskId: null,
        nodeId: null,
        roleId: reviewer.id,
        directory: message.directory,
        title: `${SESSION_TITLE_PREFIX} · ${next.memberEmail} · ${next.periodFrom}..${next.periodTo}`,
        model: reviewer.model ?? settings.get('ai.defaultModel'),
        prompt: message.prompt,
      })
      .catch((err: unknown) => {
        // The session could not start: this analysis fails, the next one gets its turn.
        log.warn({ err, analysisId: next.id }, 'Team analysis did not start');
        const current = mustFind(next.id);
        if (current.status === TeamAnalysisStatus.Running) {
          unit.transact(() => move(current, TeamAnalysisEvent.Fail, { error: errorOf(err) }));
        }
        pump(projectId);
      });
  }

  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.kind !== AttemptKind.TeamAnalysis) return;
    const analysis = repo.findByAttempt(attempt.id);
    if (analysis === undefined) throw new Error(`Team analysis attempt ${attempt.id} has no analysis`);
    // Submitted or cancelled already: only a session that ended without either fails it.
    if (analysis.status === TeamAnalysisStatus.Running) {
      unit.transact(() =>
        move(analysis, TeamAnalysisEvent.Fail, {
          error: attempt.error ?? { code: ErrorCode.TeamAnalysisInterrupted, message: `Attempt ${attempt.status}` },
        }),
      );
    }
    pump(analysis.projectId);
  });

  async function validate(analysis: Analysis, input: SubmitMemberAnalysisInput, repoPath: string): Promise<void> {
    const inPeriod = new Set(analysis.commits);
    const sampled = new Set(analysis.sample.map((s) => s.sha));
    type Problem = { path: string; code: TeamAnalysisProblemCode; hint: string; lineCount?: number };
    const problems: Problem[] = [];
    const cite = (path: string, shas: readonly string[]) => {
      for (const sha of shas) {
        if (!inPeriod.has(sha)) {
          const code = TeamAnalysisProblemCode.CommitNotInPeriod;
          problems.push({ path: `${path}: ${sha}`, code, hint: TEAM_ANALYSIS_PROBLEM_HINT[code] });
        }
      }
    };
    for (const [field, items] of [
      ['work_items', input.work_items],
      ['strengths', input.strengths],
      ['concerns', input.concerns],
    ] as const) {
      for (const [i, item] of items.entries()) cite(`${field}[${i}]`, item.commits);
    }
    for (const [i, f] of input.findings.entries()) {
      const at = `findings[${i}]`;
      if (!sampled.has(f.commit)) {
        const code = TeamAnalysisProblemCode.CommitNotSampled;
        problems.push({ path: at, code, hint: TEAM_ANALYSIS_PROBLEM_HINT[code] });
        continue;
      }
      if (!deps.filesOf(analysis.projectId, f.commit).includes(f.path)) {
        const code = TeamAnalysisProblemCode.PathNotInCommit;
        problems.push({ path: at, code, hint: TEAM_ANALYSIS_PROBLEM_HINT[code] });
        continue;
      }
      if (f.line === undefined) continue;
      const rev = f.side === DiffSide.Old ? `${f.commit}^` : f.commit;
      const lines = await lineCountAt(repoPath, rev, f.path);
      const end = f.end_line ?? f.line;
      if (lines === undefined || end < f.line || end > lines) {
        const code = TeamAnalysisProblemCode.LineOutOfRange;
        problems.push({
          path: at,
          code,
          hint: TEAM_ANALYSIS_PROBLEM_HINT[code],
          ...(lines === undefined ? {} : { lineCount: lines }),
        });
      }
    }
    if (problems.length > 0) {
      throw new AppError(ErrorCode.TeamAnalysisInvalid, 'Some parts of the analysis do not match the commits', {
        problems,
        sampled: [...sampled],
      });
    }
  }

  return {
    get: (id: string): TeamAnalysisDTO => toDto(mustFind(id)),
    list: (projectId: string, member?: string): TeamAnalysisDTO[] =>
      repo.list(projectId, member?.toLowerCase()).map(toDto),

    /** Each member's latest analysis of exactly this branch and range, for the member table (33 §6.5). */
    latest(projectId: string, ref: string, from: string, to: string) {
      const latest = new Map<string, Analysis>();
      // Newest first: the first of each member is its latest.
      for (const a of repo.list(projectId)) {
        if (a.ref === ref && a.periodFrom === from && a.periodTo === to && !latest.has(a.memberEmail)) {
          latest.set(a.memberEmail, a);
        }
      }
      return [...latest.values()].map((a) => ({
        id: a.id,
        member: a.memberEmail,
        status: a.status,
        quality: qualityOf(a),
      }));
    },

    /** Queues one analysis per member; the first starts at once when none of the project runs (33 §6.4). */
    async create(query: TeamQuery, members: readonly string[]): Promise<TeamAnalysisDTO[]> {
      attempts.requireReady();
      const keys = [...new Set(members.map((m) => m.toLowerCase()))];
      const work = await deps.work(query, keys);
      const active = repo.withStatus(ACTIVE, work.project.id);
      for (const member of work.members) {
        if (active.some((a) => a.memberEmail === member.key && a.periodFrom === work.from && a.periodTo === work.to)) {
          throw new AppError(ErrorCode.TeamAnalysisExists, `${member.key} is being analysed for this range`, {
            member: member.key,
          });
        }
      }
      const created = work.members.map((member) => {
        const sample = sampleOf(member.commits);
        const analysis: Analysis = {
          id: randomUUID(),
          projectId: work.project.id,
          memberEmail: member.key,
          ref: work.ref,
          refSha: work.tipSha,
          periodFrom: work.from,
          periodTo: work.to,
          status: TeamAnalysisStatus.Queued,
          commits: member.commits.map((c) => c.sha),
          sample,
          attemptId: null,
          report: null,
          error: null,
          createdAt: clock.now(),
          finishedAt: null,
        };
        firstMessages.set(analysis.id, {
          directory: work.project.repoPath,
          prompt: firstMessage(prompts, work, member, sample),
        });
        return analysis;
      });
      unit.transact(() => {
        for (const analysis of created) {
          repo.insert(analysis);
          unit.publish({
            type: ServerEventType.TeamAnalysisUpdated,
            data: { projectId: analysis.projectId, analysisId: analysis.id },
          });
        }
      });
      pump(work.project.id);
      return created.map((a) => toDto(mustFind(a.id)));
    },

    async cancel(id: string): Promise<TeamAnalysisDTO> {
      const analysis = mustFind(id);
      unit.transact(() => move(analysis, TeamAnalysisEvent.Cancel));
      firstMessages.delete(id);
      if (analysis.attemptId !== null && analysis.status === TeamAnalysisStatus.Running) {
        await attempts.abort(analysis.attemptId);
      }
      return toDto(mustFind(id));
    },

    /** `submit_member_analysis` (33 §6.6): checked against the member's commits, then stored. */
    async submit(attempt: AttemptDTO, input: SubmitMemberAnalysisInput): Promise<void> {
      const analysis = repo.findByAttempt(attempt.id);
      if (analysis === undefined) throw new Error(`Team analysis attempt ${attempt.id} has no analysis`);
      await validate(analysis, input, deps.repoPathOf(analysis.projectId));
      unit.transact(() => {
        move(mustFind(analysis.id), TeamAnalysisEvent.Submit, { report: input });
        attempts.markSubmitted(attempt.id);
      });
    },

    /**
     * Startup (after the attempts' own recovery): analyses still queued or running belong to the previous run,
     * whose sessions and queue are gone.
     */
    recover(): void {
      unit.transact(() => {
        for (const analysis of repo.withStatus(ACTIVE)) {
          move(analysis, TeamAnalysisEvent.Fail, { error: interrupted() });
        }
      });
    },
  };
}
export type TeamAnalyses = ReturnType<typeof createTeamAnalyses>;

const interrupted = (): ErrorInfo => ({
  code: ErrorCode.TeamAnalysisInterrupted,
  message: 'The app stopped before the analysis finished',
});

const errorOf = (err: unknown): ErrorInfo =>
  err instanceof AppError ? err.toInfo() : { code: ErrorCode.InternalError, message: String(err) };
