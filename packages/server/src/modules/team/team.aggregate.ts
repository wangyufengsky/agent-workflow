import { matchesGlob } from 'node:path';
import {
  TEAM_TOP_DIRECTORIES,
  TEAM_WORK_TYPES,
  type TeamCommitDTO,
  type TeamDirectoryDTO,
  type TeamMediansDTO,
  type TeamMemberDTO,
  type TeamMetricsDTO,
  type TeamOtherDTO,
  TeamOtherKind,
  type TeamPointDTO,
  type TeamSettingsDTO,
  type TeamWorkType,
} from '@aw/shared';
import { localDateIn } from '../../core/time-zone.ts';
import { type CommitFile, classifyWork } from './team.parse.ts';
import type { TeamRange } from './team.period.ts';

/** A commit as the repo reads it back from the cache. */
export type StoredCommit = {
  sha: string;
  authorEmail: string;
  authorName: string;
  authoredAt: number;
  subject: string;
  aiTask: boolean;
  aiCoauthor: boolean;
  requestedByEmail: string | null;
  requestedByName: string | null;
  files: CommitFile[];
};

export type Identity = { email: string; memberEmail: string | null; displayName: string | null; hidden: boolean };

/** A commit with the project's rules applied (33 §2.4) and its owner worked out (33 §2.3). */
export type CountedCommit = {
  sha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  date: string;
  /** Lines of counted files; zero when huge. */
  added: number;
  deleted: number;
  /** Counted files, binary ones included. */
  paths: string[];
  /** Counted lines per counted file; empty when huge. */
  lines: Map<string, number>;
  huge: boolean;
  code: boolean;
  test: boolean;
  workType: TeamWorkType;
  ai: boolean;
  viaTask: boolean;
  reverted: boolean;
  /** A member's main email, or the key of an other (33 §2.3). */
  owner: { kind: 'member'; key: string } | { kind: TeamOtherKind; key: string };
};

/** The key the commits of this app's tasks nobody is named on go under. */
export const AI_TASK_KEY = 'ai-task';

/** Whether files are counted and are tests; one answer per path, as every commit of a period asks again. */
function fileRules(settings: TeamSettingsDTO) {
  const cache = new Map<string, { counted: boolean; test: boolean }>();
  return (path: string) => {
    let rule = cache.get(path);
    if (rule === undefined) {
      rule = {
        counted: !settings.excludeGlobs.some((g) => matchesGlob(path, g)),
        test: settings.testGlobs.some((g) => matchesGlob(path, g)),
      };
      cache.set(path, rule);
    }
    return rule;
  };
}

/** The member an email counts as: its main identity, unless that is set as not a member. */
export function membership(identities: Identity[]) {
  const byEmail = new Map(identities.map((i) => [i.email, i]));
  return (email: string): { kind: 'member'; key: string } | { kind: typeof TeamOtherKind.Hidden; key: string } => {
    const key = byEmail.get(email)?.memberEmail ?? email;
    return byEmail.get(key)?.hidden === true ? { kind: TeamOtherKind.Hidden, key } : { kind: 'member', key };
  };
}

export function countCommits(
  commits: StoredCommit[],
  settings: TeamSettingsDTO,
  identities: Identity[],
  revertedShas: ReadonlySet<string>,
  timeZone: string,
): CountedCommit[] {
  const rule = fileRules(settings);
  const memberOf = membership(identities);
  const dateOf = localDateIn(timeZone);
  return commits.map((c) => {
    const counted = c.files.filter((f) => rule(f.path).counted);
    const lineCount = (f: CommitFile) => (f.added ?? 0) + (f.deleted ?? 0);
    const total = counted.reduce((n, f) => n + lineCount(f), 0);
    const huge = total > settings.hugeCommitLines;
    const starter = c.requestedByEmail;
    const owner = c.aiTask
      ? starter === null
        ? { kind: TeamOtherKind.AiTask, key: AI_TASK_KEY }
        : memberOf(starter)
      : memberOf(c.authorEmail);
    return {
      sha: c.sha,
      subject: c.subject,
      authorName: c.aiTask && c.requestedByName !== null ? c.requestedByName : c.authorName,
      authorEmail: c.aiTask && starter !== null ? starter : c.authorEmail,
      authoredAt: c.authoredAt,
      date: dateOf(c.authoredAt),
      added: huge ? 0 : counted.reduce((n, f) => n + (f.added ?? 0), 0),
      deleted: huge ? 0 : counted.reduce((n, f) => n + (f.deleted ?? 0), 0),
      paths: counted.map((f) => f.path),
      lines: huge ? new Map() : new Map(counted.map((f) => [f.path, lineCount(f)])),
      huge,
      code: counted.some((f) => !rule(f.path).test),
      test: counted.some((f) => rule(f.path).test),
      workType: classifyWork(c.subject),
      ai: c.aiTask || c.aiCoauthor || starter !== null,
      viaTask: c.aiTask && starter !== null,
      reverted: revertedShas.has(c.sha),
      owner,
    };
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function metricsOf(commits: CountedCommit[]): TeamMetricsDTO {
  const workMix = Object.fromEntries(TEAM_WORK_TYPES.map((t) => [t, 0])) as Record<TeamWorkType, number>;
  for (const c of commits) workMix[c.workType] += 1;
  const codeCommits = commits.filter((c) => c.code).length;
  const testCommits = commits.filter((c) => c.code && c.test).length;
  return {
    commits: commits.length,
    activeDays: new Set(commits.map((c) => c.date)).size,
    added: commits.reduce((n, c) => n + c.added, 0),
    deleted: commits.reduce((n, c) => n + c.deleted, 0),
    files: new Set(commits.flatMap((c) => c.paths)).size,
    commitLinesMedian: median(commits.filter((c) => !c.huge).map((c) => c.added + c.deleted)),
    hugeCommits: commits.filter((c) => c.huge).length,
    codeCommits,
    testCommits,
    testRate: codeCommits === 0 ? null : testCommits / codeCommits,
    reverted: commits.filter((c) => c.reverted).length,
    aiCommits: commits.filter((c) => c.ai).length,
    taskCommits: commits.filter((c) => c.viaTask).length,
    workMix,
  };
}

/** Medians across the members with a commit in the period (33 §3.4). */
export function mediansOf(members: TeamMetricsDTO[]): TeamMediansDTO {
  const active = members.filter((m) => m.commits > 0);
  const of = (pick: (m: TeamMetricsDTO) => number | null) =>
    median(active.map(pick).filter((v): v is number => v !== null));
  return {
    commits: of((m) => m.commits),
    activeDays: of((m) => m.activeDays),
    added: of((m) => m.added),
    deleted: of((m) => m.deleted),
    files: of((m) => m.files),
    commitLinesMedian: of((m) => m.commitLinesMedian),
    testRate: of((m) => m.testRate),
    reverted: of((m) => m.reverted),
    aiCommits: of((m) => m.aiCommits),
  };
}

export function seriesOf(commits: CountedCommit[], range: TeamRange): TeamPointDTO[] {
  const points = range.buckets.map(() => ({ commits: 0, added: 0, deleted: 0, codeCommits: 0, testCommits: 0 }));
  for (const c of commits) {
    const point = points[range.bucketOf(c.date) ?? -1];
    if (point === undefined) continue;
    point.commits += 1;
    point.added += c.added;
    point.deleted += c.deleted;
    if (c.code) point.codeCommits += 1;
    if (c.code && c.test) point.testCommits += 1;
  }
  return points;
}

/** A path's first two directory levels; files at the top are under ''. */
export function directoryOf(path: string): string {
  const parts = path.split('/').slice(0, -1);
  return parts.slice(0, 2).join('/');
}

/** Counted lines by directory and member, the most changed first (33 §3.1). */
export function directoriesOf(commits: CountedCommit[]): TeamDirectoryDTO[] {
  const dirs = new Map<string, Map<string, number>>();
  for (const c of commits) {
    for (const [path, lines] of c.lines) {
      const byMember = dirs.get(directoryOf(path)) ?? new Map<string, number>();
      byMember.set(c.owner.key, (byMember.get(c.owner.key) ?? 0) + lines);
      dirs.set(directoryOf(path), byMember);
    }
  }
  return [...dirs]
    .map(([path, byMember]) => ({
      path,
      lines: [...byMember.values()].reduce((n, l) => n + l, 0),
      members: [...byMember].map(([key, lines]) => ({ key, lines })).sort((x, y) => y.lines - x.lines),
    }))
    .filter((d) => d.lines > 0)
    .sort((x, y) => y.lines - x.lines || x.path.localeCompare(y.path))
    .slice(0, TEAM_TOP_DIRECTORIES);
}

type Group = { key: string; kind: 'member' | TeamOtherKind; current: CountedCommit[]; previous: CountedCommit[] };

/** Names: the main identity's display name, else the newest author name of the group's commits. */
export function nameOf(
  group: { key: string; current: CountedCommit[]; previous: CountedCommit[] },
  identities: Map<string, Identity>,
): string {
  const newest = [...group.current, ...group.previous].sort((x, y) => y.authoredAt - x.authoredAt)[0];
  return identities.get(group.key)?.displayName ?? newest?.authorName ?? group.key;
}

export type TeamFigures = {
  totals: TeamMetricsDTO;
  previousTotals: TeamMetricsDTO;
  medians: TeamMediansDTO;
  members: TeamMemberDTO[];
  others: TeamOtherDTO[];
  directories: TeamDirectoryDTO[];
  /** The counted commits by owner key, for a member page and the commit list. */
  byOwner: Map<string, { key: string; current: CountedCommit[]; previous: CountedCommit[] }>;
};

/** 33 §3 from the commits of the period and the period before it. */
export function aggregateTeam(
  current: CountedCommit[],
  previous: CountedCommit[],
  identities: Identity[],
  range: TeamRange,
): TeamFigures {
  const groups = new Map<string, Group>();
  const groupOf = (c: CountedCommit) => {
    let group = groups.get(c.owner.key);
    if (group === undefined) {
      group = { key: c.owner.key, kind: c.owner.kind, current: [], previous: [] };
      groups.set(c.owner.key, group);
    }
    return group;
  };
  for (const c of current) groupOf(c).current.push(c);
  for (const c of previous) groupOf(c).previous.push(c);

  const byEmail = new Map(identities.map((i) => [i.email, i]));
  const emailsOf = (group: Group) =>
    [...new Set([...group.current, ...group.previous].map((c) => c.authorEmail))].sort();
  const all = [...groups.values()];
  const members: TeamMemberDTO[] = all
    .filter((g) => g.kind === 'member')
    .map((g) => ({
      key: g.key,
      name: nameOf(g, byEmail),
      emails: emailsOf(g),
      metrics: metricsOf(g.current),
      previous: metricsOf(g.previous),
      series: seriesOf(g.current, range),
    }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.key.localeCompare(y.key));
  const others: TeamOtherDTO[] = all
    .flatMap((g) => (g.kind === 'member' ? [] : [{ group: g, kind: g.kind }]))
    .map(({ group, kind }) => ({
      key: group.key,
      kind,
      name: kind === TeamOtherKind.AiTask ? '' : nameOf(group, byEmail),
      emails: kind === TeamOtherKind.AiTask ? [] : emailsOf(group),
      metrics: metricsOf(group.current),
    }))
    .filter((o) => o.metrics.commits > 0)
    .sort((x, y) => y.metrics.commits - x.metrics.commits);

  const isMember = (c: CountedCommit) => c.owner.kind === 'member';
  const memberCurrent = current.filter(isMember);
  return {
    totals: metricsOf(memberCurrent),
    previousTotals: metricsOf(previous.filter(isMember)),
    medians: mediansOf(members.map((m) => m.metrics)),
    members,
    others,
    directories: directoriesOf(memberCurrent),
    byOwner: new Map(all.map((g) => [g.key, g])),
  };
}

export function commitRow(c: CountedCommit): TeamCommitDTO {
  return {
    sha: c.sha,
    subject: c.subject,
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    authoredAt: c.authoredAt,
    added: c.added,
    deleted: c.deleted,
    files: c.paths.length,
    workType: c.workType,
    huge: c.huge,
    reverted: c.reverted,
    ai: c.ai,
    viaTask: c.viaTask,
  };
}
