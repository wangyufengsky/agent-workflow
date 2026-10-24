import {
  GIT_COMMIT_IDENTITY,
  TEAM_DEFAULT_EXCLUDE_GLOBS,
  TEAM_DEFAULT_TEST_GLOBS,
  TeamGranularity,
  TeamOtherKind,
  TeamPeriod,
  type TeamSettingsDTO,
} from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../../core/time-zone.ts';
import { AI_TASK_KEY, aggregateTeam, countCommits, type Identity, type StoredCommit } from './team.aggregate.ts';
import { resolveTeamRange } from './team.period.ts';

const TZ = 'Asia/Shanghai';
/** Wednesday 2026-10-21, noon in Shanghai. */
const NOW = zonedInstant('2026-10-21', 12 * 60, TZ);
const SETTINGS: TeamSettingsDTO = {
  excludeGlobs: [...TEAM_DEFAULT_EXCLUDE_GLOBS],
  testGlobs: [...TEAM_DEFAULT_TEST_GLOBS],
  hugeCommitLines: 100,
};

let seq = 0;
function commit(date: string, email: string, files: StoredCommit['files'], extra: Partial<StoredCommit> = {}) {
  seq += 1;
  return {
    sha: String(seq).padStart(40, '0'),
    authorEmail: email,
    authorName: email.split('@')[0] ?? email,
    authoredAt: zonedInstant(date, 10 * 60, TZ),
    subject: 'feat: work',
    aiTask: false,
    aiCoauthor: false,
    requestedByEmail: null,
    requestedByName: null,
    files,
    ...extra,
  } satisfies StoredCommit;
}

function run(
  commits: StoredCommit[],
  identities: Identity[] = [],
  reverted: string[] = [],
  granularity?: TeamGranularity,
) {
  const range = resolveTeamRange({ period: TeamPeriod.Last30Days, granularity }, NOW, TZ);
  const counted = countCommits(commits, SETTINGS, identities, new Set(reverted), TZ);
  return aggregateTeam(
    counted.filter((c) => c.authoredAt >= range.start),
    counted.filter((c) => c.authoredAt < range.start),
    identities,
    range,
  );
}

describe('团队指标', () => {
  it('没有提交：合计为 0、比率与中位数为空、每个桶都有点', () => {
    const figures = run([]);
    expect(figures.totals).toMatchObject({ commits: 0, added: 0, testRate: null, commitLinesMedian: null });
    expect(figures.medians.commits).toBeNull();
    expect(figures.members).toEqual([]);
  });

  it('排除锁文件与超大提交的行数、测试伴随率、被回滚记在原作者、AI 标记', () => {
    const zs = 'zs@example.com';
    const withTest = commit('2026-10-20', zs, [
      { path: 'src/a.ts', added: 10, deleted: 2 },
      { path: 'src/a.test.ts', added: 5, deleted: 0 },
      { path: 'pnpm-lock.yaml', added: 900, deleted: 300 },
    ]);
    const codeOnly = commit('2026-10-20', zs, [{ path: 'src/b.ts', added: 3, deleted: 3 }], { aiCoauthor: true });
    const huge = commit('2026-10-19', zs, [{ path: 'src/gen.ts', added: 5000, deleted: 0 }]);
    const docs = commit('2026-10-18', zs, [{ path: 'README.md', added: 1, deleted: 0 }], { subject: 'docs: x' });

    const [member] = run([withTest, codeOnly, huge, docs], [], [codeOnly.sha]).members;
    expect(member?.metrics).toMatchObject({
      commits: 4,
      activeDays: 3,
      added: 10 + 5 + 3 + 1,
      deleted: 2 + 3,
      hugeCommits: 1,
      // The README commit changes no test and is code too; the huge one changes code without tests.
      codeCommits: 4,
      testCommits: 1,
      testRate: 0.25,
      reverted: 1,
      aiCommits: 1,
      // 17, 6, 1 lines; the huge commit has none counted.
      commitLinesMedian: 6,
    });
    expect(member?.metrics.workMix).toMatchObject({ feature: 3, docs: 1 });
  });

  it('合并身份、非成员与本应用任务的提交：发起人 trailer 归到发起人', () => {
    const work = [{ path: 'src/a.ts', added: 1, deleted: 0 }];
    const commits = [
      commit('2026-10-20', 'zs@corp.com', work),
      commit('2026-10-20', 'zs@home.com', work),
      commit('2026-10-20', 'bot@ci.com', work),
      commit('2026-10-20', GIT_COMMIT_IDENTITY.email, work, { aiTask: true }),
      commit('2026-10-20', GIT_COMMIT_IDENTITY.email, work, {
        aiTask: true,
        requestedByEmail: 'zs@home.com',
        requestedByName: 'Zhang San',
      }),
    ];
    const identities: Identity[] = [
      { email: 'zs@corp.com', memberEmail: null, displayName: '张三', hidden: false },
      { email: 'zs@home.com', memberEmail: 'zs@corp.com', displayName: null, hidden: false },
      { email: 'bot@ci.com', memberEmail: null, displayName: null, hidden: true },
    ];

    const figures = run(commits, identities);
    expect(figures.members).toHaveLength(1);
    expect(figures.members[0]).toMatchObject({
      key: 'zs@corp.com',
      name: '张三',
      emails: ['zs@corp.com', 'zs@home.com'],
    });
    expect(figures.members[0]?.metrics).toMatchObject({ commits: 3, aiCommits: 1, taskCommits: 1 });
    expect(figures.others.map((o) => [o.kind, o.key, o.metrics.commits])).toEqual([
      [TeamOtherKind.Hidden, 'bot@ci.com', 1],
      [TeamOtherKind.AiTask, AI_TASK_KEY, 1],
    ]);
    // Others stay out of the team figures.
    expect(figures.totals.commits).toBe(3);
    expect(figures.medians.commits).toBe(3);
  });

  it('按周分桶从周一开始、首尾按时间段截断；上一段同长度', () => {
    const work = [{ path: 'src/a.ts', added: 1, deleted: 0 }];
    const commits = [
      // 2026-09-22 is the first day of the period (a Tuesday); the week of it runs to Sunday 09-27.
      commit('2026-09-22', 'zs@example.com', work),
      commit('2026-09-27', 'zs@example.com', work),
      commit('2026-09-28', 'zs@example.com', work),
      commit('2026-10-21', 'zs@example.com', work),
      // In the 30 days before.
      commit('2026-09-01', 'zs@example.com', work),
    ];
    const figures = run(commits, [], [], TeamGranularity.Week);
    const range = resolveTeamRange({ period: TeamPeriod.Last30Days, granularity: TeamGranularity.Week }, NOW, TZ);
    expect(range.buckets[0]).toEqual({ from: '2026-09-22', to: '2026-09-27' });
    expect(range.buckets.at(-1)).toEqual({ from: '2026-10-19', to: '2026-10-21' });
    const [member] = figures.members;
    expect(member?.series.map((p) => p.commits)).toEqual([2, 1, 0, 0, 1]);
    expect(member?.previous.commits).toBe(1);
  });

  it('按月分桶与默认分桶', () => {
    expect(resolveTeamRange({ period: TeamPeriod.Last30Days }, NOW, TZ).granularity).toBe(TeamGranularity.Day);
    expect(resolveTeamRange({ period: TeamPeriod.Last90Days }, NOW, TZ).granularity).toBe(TeamGranularity.Week);
    const year = resolveTeamRange({ period: TeamPeriod.Last365Days }, NOW, TZ);
    expect(year.granularity).toBe(TeamGranularity.Month);
    expect(year.buckets[0]).toEqual({ from: '2025-10-22', to: '2025-10-31' });
    expect(year.buckets[1]).toEqual({ from: '2025-11-01', to: '2025-11-30' });
    expect(year.buckets.at(-1)).toEqual({ from: '2026-10-01', to: '2026-10-21' });
    expect(year.buckets).toHaveLength(13);
  });
});
