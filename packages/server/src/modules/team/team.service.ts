import type { Prompts } from '@aw/builtin';
import {
  AppError,
  ErrorCode,
  ServerEventType,
  TEAM_DEFAULT_EXCLUDE_GLOBS,
  TEAM_DEFAULT_TEST_GLOBS,
  TEAM_HUGE_COMMIT_LINES,
  type TeamCommitDTO,
  type TeamCommitsQuery,
  type TeamIdentityDTO,
  type TeamIdentityUpdate,
  type TeamMemberDetailDTO,
  type TeamMemberQuery,
  type TeamQuery,
  type TeamSettingsDTO,
  type TeamSettingsUpdate,
  type TeamSummaryDTO,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import { readFetchedAt } from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import {
  aggregateTeam,
  commitRow,
  countCommits,
  directoriesOf,
  type Identity,
  membership,
  metricsOf,
  nameOf,
  seriesOf,
} from './team.aggregate.ts';
import { createTeamAnalyses } from './team.analysis.ts';
import { resolveTeamRange } from './team.period.ts';
import { createTeamRepo } from './team.repo.ts';
import {
  type ReachableCommit,
  reachableCommits,
  readCommits,
  readTip,
  SCAN_BATCH,
  SCAN_PROCESSES,
} from './team.scan.ts';

export type TeamServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  events: EventBus;
  clock: Clock;
  log: Logger;
  /** Days are counted in it, as on the quality and usage page (19 §2.2). */
  timeZone: string;
  projects: ProjectsService;
  /** For the AI member analyses (33 §6). */
  attempts: AttemptsService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
};

const COMMITS_PAGE = 50;
/** Branch tips whose history is kept, across projects. */
const HISTORIES_KEPT = 16;

/** The team page (33): figures from a project's Git history, read once into the commit cache (D129). */
export function createTeamService(deps: TeamServiceDeps) {
  const { db, events, clock, timeZone, projects } = deps;
  const repo = createTeamRepo(db);
  /** One reading per project at a time (33 §7.2); a second caller waits for it, then reads what is still missing. */
  const scans = new Map<string, Promise<void>>();
  /**
   * The history each recent tip reaches: it cannot change while the tip stays the same, and walking a long history
   * costs a few hundred milliseconds on every request otherwise.
   */
  const histories = new Map<string, ReachableCommit[]>();
  async function historyOf(repoPath: string, tip: string): Promise<ReachableCommit[]> {
    const key = `${repoPath}\0${tip}`;
    let history = histories.get(key);
    if (history === undefined) {
      history = await reachableCommits(repoPath, tip);
      if (histories.size >= HISTORIES_KEPT) histories.delete(histories.keys().next().value ?? '');
      histories.set(key, history);
    }
    return history;
  }
  /** Commits known to be cached, by project: a commit never leaves the cache, so asking once is enough. */
  const known = new Map<string, Set<string>>();
  const knownOf = (projectId: string) => {
    let set = known.get(projectId);
    if (set === undefined) {
      set = new Set();
      known.set(projectId, set);
    }
    return set;
  };

  /** Reads the missing commits in batches, several git processes at a time; each batch is stored as it arrives. */
  async function scan(projectId: string, repoPath: string, missing: string[]): Promise<void> {
    const total = missing.length;
    const batches: string[][] = [];
    for (let i = 0; i < total; i += SCAN_BATCH) batches.push(missing.slice(i, i + SCAN_BATCH));
    let done = 0;
    events.publish({ type: ServerEventType.TeamScanUpdated, data: { projectId, done, total } });
    const worker = async () => {
      for (let batch = batches.shift(); batch !== undefined; batch = batches.shift()) {
        const commits = await readCommits(repoPath, batch);
        db.transaction((tx) => createTeamRepo(tx).insertCommits(projectId, commits));
        for (const sha of batch) knownOf(projectId).add(sha);
        done += batch.length;
        events.publish({ type: ServerEventType.TeamScanUpdated, data: { projectId, done, total } });
      }
    };
    await Promise.all(Array.from({ length: SCAN_PROCESSES }, worker));
  }

  async function ensureScanned(projectId: string, repoPath: string, shas: string[]): Promise<void> {
    for (;;) {
      const running = scans.get(projectId);
      if (running !== undefined) {
        await running;
        continue;
      }
      const seen = knownOf(projectId);
      const unknown = shas.filter((sha) => !seen.has(sha));
      const cached = repo.cachedOf(projectId, unknown);
      for (const sha of cached) seen.add(sha);
      const missing = unknown.filter((sha) => !cached.has(sha));
      if (missing.length === 0) return;
      const reading = scan(projectId, repoPath, missing).finally(() => scans.delete(projectId));
      scans.set(projectId, reading);
      return reading;
    }
  }

  function settingsOf(projectId: string): TeamSettingsDTO {
    const stored = repo.settings(projectId);
    return {
      excludeGlobs: stored.excludeGlobs ?? [...TEAM_DEFAULT_EXCLUDE_GLOBS],
      testGlobs: stored.testGlobs ?? [...TEAM_DEFAULT_TEST_GLOBS],
      hugeCommitLines: stored.hugeCommitLines ?? TEAM_HUGE_COMMIT_LINES,
    };
  }

  /** Everything 33 §3 counts for the query's branch and period. */
  async function analyse(query: TeamQuery) {
    const project = projects.getRecord(query.id);
    const ref = query.ref ?? project.defaultBranch;
    const tip = await readTip(project.repoPath, ref);
    const range = resolveTeamRange(query, clock.now(), timeZone);
    // Back to the start of the period compared with; reverts come after what they revert, so they are in too.
    const [history, fetchedAt] = await Promise.all([
      historyOf(project.repoPath, tip.sha),
      readFetchedAt(project.repoPath),
    ]);
    const shas = history.filter((c) => c.authoredAt >= range.previous.start).map((c) => c.sha);
    await ensureScanned(project.id, project.repoPath, shas);
    const reachable = new Set(shas);
    const stored = repo.commitsIn(project.id, range.previous.start, range.end).filter((c) => reachable.has(c.sha));
    const reverted = new Set(
      repo
        .reverts(project.id)
        .filter((r) => reachable.has(r.sha))
        .map((r) => r.revertsSha),
    );
    const identities = repo.identities(project.id);
    const counted = countCommits(stored, settingsOf(project.id), identities, reverted, timeZone);
    const figures = aggregateTeam(
      counted.filter((c) => c.authoredAt >= range.start),
      counted.filter((c) => c.authoredAt < range.start),
      identities,
      range,
    );
    const scope = {
      ref,
      tip,
      fetchedAt,
      period: { period: range.period, from: range.from, to: range.to, timeZone },
      granularity: range.granularity,
      buckets: range.buckets,
    };
    return { project, range, scope, identities, figures };
  }

  /** The member a main email names, its commits, and the identities that count as it. */
  async function member(query: TeamMemberQuery) {
    const analysed = await analyse(query);
    const { project, identities, figures } = analysed;
    const key = query.member.toLowerCase();
    const group = figures.byOwner.get(key) ?? { key, current: [], previous: [] };
    const memberOf = membership(identities);
    const listed = identities.filter((i) => memberOf(i.email).key === key).map((i) => i.email);
    const emails = [...new Set([key, ...listed, ...[...group.current, ...group.previous].map((c) => c.authorEmail)])];
    const names = repo.authorNames(project.id, emails);
    if (group.current.length + group.previous.length === 0 && listed.length === 0 && !names.has(key)) {
      throw new AppError(ErrorCode.NotFound, `No team member ${key}`, { object: key });
    }
    return { ...analysed, key, group, emails: emails.sort(), names };
  }

  const analyses = createTeamAnalyses({
    ...deps,
    filesOf: repo.filesOf,
    repoPathOf: (projectId) => projects.getRecord(projectId).repoPath,
    async work(query, keys) {
      const { project, scope, range, identities, figures } = await analyse(query);
      const byEmail = new Map(identities.map((i) => [i.email, i]));
      return {
        project,
        ref: scope.ref,
        tipSha: scope.tip.sha,
        from: range.from,
        to: range.to,
        members: keys.map((key) => {
          const group = figures.byOwner.get(key) ?? { key, current: [], previous: [] };
          return {
            key,
            name: nameOf(group, byEmail),
            emails: [...new Set([key, ...group.current.map((c) => c.authorEmail)])],
            commits: group.current,
            metrics: metricsOf(group.current),
          };
        }),
      };
    },
  });

  return {
    async summary(query: TeamQuery): Promise<TeamSummaryDTO> {
      const { scope, figures } = await analyse(query);
      const { byOwner: _, ...rest } = figures;
      const latest = analyses.latest(query.id, scope.ref, scope.period.from, scope.period.to);
      return { ...scope, ...rest, analyses: latest };
    },

    analyses,

    async member(query: TeamMemberQuery): Promise<TeamMemberDetailDTO> {
      const { scope, range, identities, figures, key, group, emails, names } = await member(query);
      const byEmail = new Map(identities.map((i) => [i.email, i]));
      const identityOf = (email: string): TeamIdentityDTO => ({
        email,
        authorName: names.get(email) ?? email,
        memberEmail: byEmail.get(email)?.memberEmail ?? null,
        displayName: byEmail.get(email)?.displayName ?? null,
        hidden: byEmail.get(email)?.hidden ?? false,
      });
      return {
        ...scope,
        member: {
          key,
          name:
            group.current.length + group.previous.length === 0
              ? (byEmail.get(key)?.displayName ?? names.get(key) ?? key)
              : nameOf(group, byEmail),
          emails,
          metrics: metricsOf(group.current),
          previous: metricsOf(group.previous),
          series: seriesOf(group.current, range),
        },
        hidden: byEmail.get(key)?.hidden ?? false,
        identities: emails.map(identityOf),
        medians: figures.medians,
        directories: directoriesOf(group.current).map(({ path, lines }) => ({ path, lines })),
      };
    },

    async commits(query: TeamCommitsQuery): Promise<{ items: TeamCommitDTO[]; nextCursor: string | null }> {
      const { group } = await member(query);
      const skip = query.cursor === undefined ? 0 : Number(query.cursor);
      const newest = [...group.current].sort((x, y) => y.authoredAt - x.authoredAt);
      return {
        items: newest.slice(skip, skip + COMMITS_PAGE).map(commitRow),
        nextCursor: newest.length > skip + COMMITS_PAGE ? String(skip + COMMITS_PAGE) : null,
      };
    },

    /**
     * Merging an identity into a main one also moves the identities merged into it, so that merges stay one level
     * deep (33 §2.3).
     */
    updateIdentity(update: TeamIdentityUpdate): TeamIdentityDTO {
      const project = projects.getRecord(update.id);
      const email = update.email.toLowerCase();
      const identities = repo.identities(project.id);
      const current: Identity = identities.find((i) => i.email === email) ?? {
        email,
        memberEmail: null,
        displayName: null,
        hidden: false,
      };
      const target =
        update.memberEmail === undefined ? current.memberEmail : (update.memberEmail?.toLowerCase() ?? null);
      if (target !== null && update.memberEmail !== undefined) {
        if (target === email) throw new AppError(ErrorCode.ValidationFailed, 'An identity cannot merge into itself');
        if (identities.some((i) => i.email === target && i.memberEmail !== null)) {
          throw new AppError(ErrorCode.ValidationFailed, `${target} is merged into another identity`, {
            object: target,
          });
        }
      }
      const next: Identity = {
        email,
        memberEmail: target,
        displayName: update.displayName === undefined ? current.displayName : update.displayName,
        hidden: update.hidden ?? current.hidden,
      };
      db.transaction((tx) => {
        const txRepo = createTeamRepo(tx);
        txRepo.upsertIdentity(project.id, next);
        if (target !== null) {
          for (const merged of identities.filter((i) => i.memberEmail === email)) {
            txRepo.upsertIdentity(project.id, { ...merged, memberEmail: target });
          }
        }
      });
      return { ...next, authorName: repo.authorNames(project.id, [email]).get(email) ?? email };
    },

    settings(projectId: string): TeamSettingsDTO {
      return settingsOf(projects.getRecord(projectId).id);
    },

    updateSettings(update: TeamSettingsUpdate): TeamSettingsDTO {
      const project = projects.getRecord(update.id);
      const stored = repo.settings(project.id);
      const pick = <T>(change: T | null | undefined, kept: T | null) => (change === undefined ? kept : change);
      repo.saveSettings(project.id, {
        excludeGlobs: pick(update.excludeGlobs, stored.excludeGlobs),
        testGlobs: pick(update.testGlobs, stored.testGlobs),
        hugeCommitLines: pick(update.hugeCommitLines, stored.hugeCommitLines),
      });
      return settingsOf(project.id);
    },
  };
}
export type TeamService = ReturnType<typeof createTeamService>;
