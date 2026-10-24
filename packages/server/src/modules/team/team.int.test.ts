import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createProjectOp,
  ErrorCode,
  ServerEventType,
  TeamOtherKind,
  TeamPeriod,
  teamCommitsOp,
  teamMemberOp,
  teamSummaryOp,
  updateTeamIdentityOp,
  updateTeamSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';
import { zonedInstant } from '../../core/time-zone.ts';
import { runGit } from '../git/index.ts';

const TZ = 'Asia/Shanghai';
const NOW = zonedInstant('2026-10-21', 12 * 60, TZ);
const ZS = 'Zhang San <zs@corp.com>';
const LS = 'Li Si <ls@corp.com>';

let t: TestApp;
let scans: { done: number; total: number }[];
beforeEach(async () => {
  t = await createTestApp({ clock: createFakeClock(NOW), timeZone: TZ });
  scans = [];
  t.app.events.subscribe((e) => {
    if (e.type === ServerEventType.TeamScanUpdated) scans.push({ done: e.data.done, total: e.data.total });
  });
});
afterEach(() => t.close());

/** Writes the files and commits them as `author` at 10:00 Shanghai time on `date`. */
async function commitAs(repo: TestRepo, author: string, date: string, message: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo.path, file)), { recursive: true });
    await writeFile(join(repo.path, file), content);
  }
  await repo.git('add', '-A');
  await repo.git('commit', '-q', `--author=${author}`, `--date=${date}T10:00:00+08:00`, '-m', message);
  return (await repo.git('rev-parse', 'HEAD')).trim();
}

const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;

/**
 * Zhang San (two emails joined by `.mailmap`) writes code with a test, a lock file and a change Li Si reverts; a
 * bot bumps a dependency; a side branch holds one more commit of Zhang San.
 */
async function setUp() {
  const repo = await createTestRepo({ files: { '.mailmap': 'Zhang San <zs@corp.com> <zs@home.com>\n' } });
  await commitAs(repo, ZS, '2026-10-10', 'feat: add a', { 'src/a.ts': lines(10), 'src/a.test.ts': lines(4) });
  await commitAs(repo, 'Zhang San <zs@home.com>', '2026-10-12', 'chore: lock', {
    'pnpm-lock.yaml': lines(300),
    'src/b.ts': lines(2),
  });
  const reverted = await commitAs(repo, ZS, '2026-10-14', 'feat: risky', { 'src/c.ts': lines(5) });
  await repo.git('revert', '--no-edit', reverted);
  await repo.git('commit', '-q', '--amend', '--no-edit', `--author=${LS}`, '--date=2026-10-15T10:00:00+08:00');
  await commitAs(repo, 'dependabot[bot] <bot@github.com>', '2026-10-16', 'build: bump', { 'package.json': '{}\n' });
  await repo.git('switch', '-q', '-c', 'side');
  await commitAs(repo, ZS, '2026-10-17', 'fix: side', { 'src/a.ts': lines(11) });
  await repo.git('switch', '-q', 'main');
  const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
  return { repo, project, reverted };
}

const summary = (id: string, extra: { ref?: string } = {}) =>
  t.call(teamSummaryOp, { id, period: TeamPeriod.Last30Days, ...extra });

describe('团队（33）', () => {
  it('历史中间夹着回填的旧提交时，它之前的新提交照样计入', async () => {
    const repo = await createTestRepo();
    await commitAs(repo, ZS, '2026-10-10', 'feat: first', { 'src/a.ts': lines(2) });
    // Authored and committed in 2020, on top of October's work (a cherry-picked or imported commit).
    await writeFile(join(repo.path, 'old.txt'), 'old\n');
    await repo.git('add', '-A');
    const old = '2020-01-01T10:00:00+08:00';
    await runGit(
      [
        '-c',
        'user.name=aw-test',
        '-c',
        'user.email=aw-test@example.com',
        'commit',
        '-q',
        `--author=${LS}`,
        `--date=${old}`,
        '-m',
        'chore: backfill',
      ],
      {
        cwd: repo.path,
        env: { ...process.env, GIT_COMMITTER_DATE: old },
      },
    );
    await commitAs(repo, ZS, '2026-10-12', 'feat: second', { 'src/b.ts': lines(3) });
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });

    const { body } = await summary(project.id);
    expect(body.members.map((m) => [m.key, m.metrics.commits])).toEqual([['zs@corp.com', 2]]);
  });

  it('成员指标：.mailmap 合并邮箱、锁文件不计行数、测试伴随、被回滚、机器人与中位数', async () => {
    const { project } = await setUp();

    const { status, body } = await summary(project.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ref: 'main', granularity: 'day', period: { from: '2026-09-22', to: '2026-10-21' } });
    expect(body.buckets).toHaveLength(30);
    expect(body.members.map((m) => [m.name, m.emails, m.metrics.commits])).toEqual([
      ['dependabot[bot]', ['bot@github.com'], 1],
      ['Li Si', ['ls@corp.com'], 1],
      ['Zhang San', ['zs@corp.com'], 3],
    ]);
    const zs = body.members.find((m) => m.key === 'zs@corp.com');
    expect(zs?.metrics).toMatchObject({
      added: 10 + 4 + 2 + 5,
      deleted: 0,
      codeCommits: 3,
      testCommits: 1,
      reverted: 1,
      activeDays: 3,
      workMix: { feature: 2, chore: 1 },
    });
    expect(zs?.series.filter((p) => p.commits > 0)).toHaveLength(3);
    expect(body.medians.commits).toBe(1);
    // Li Si's revert deletes the five lines again.
    expect(body.directories[0]).toMatchObject({ path: 'src', lines: 26 });
    expect(body.directories[0]?.members[0]).toEqual({ key: 'zs@corp.com', lines: 21 });
    expect(scans.at(-1)).toEqual({ done: 6, total: 6 });
  });

  it('设为非成员与合并身份；合并进已合并的身份被拒', async () => {
    const { project } = await setUp();
    // As on the page: the identities come from a summary read first.
    await summary(project.id);
    await t.call(updateTeamIdentityOp, { id: project.id, email: 'bot@github.com', hidden: true });
    const merged = await t.call(updateTeamIdentityOp, {
      id: project.id,
      email: 'ls@corp.com',
      memberEmail: 'zs@corp.com',
    });
    expect(merged.body).toMatchObject({ email: 'ls@corp.com', memberEmail: 'zs@corp.com', authorName: 'Li Si' });

    const { body } = await summary(project.id);
    expect(body.members.map((m) => [m.key, m.metrics.commits])).toEqual([['zs@corp.com', 4]]);
    expect(body.others).toMatchObject([{ kind: TeamOtherKind.Hidden, key: 'bot@github.com' }]);

    const chained = await t.call(updateTeamIdentityOp, {
      id: project.id,
      email: 'bot@github.com',
      memberEmail: 'ls@corp.com',
    });
    expect(chained.status).toBe(400);
    expect(chained.raw.json().error.code).toBe(ErrorCode.ValidationFailed);
  });

  it('换分支、合并提交不计、分支回退后复用已读的提交；不存在的分支 404', async () => {
    const { repo, project } = await setUp();
    await summary(project.id);

    const side = await summary(project.id, { ref: 'side' });
    expect(side.body.members.find((m) => m.key === 'zs@corp.com')?.metrics.commits).toBe(4);
    // Only the side commit was missing.
    expect(scans.at(-1)).toEqual({ done: 1, total: 1 });

    await repo.git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    await repo.git('reset', '-q', '--hard', 'HEAD~1');
    await repo.git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    const scansBefore = scans.length;
    const merged = await summary(project.id);
    expect(merged.body.members.find((m) => m.key === 'zs@corp.com')?.metrics.commits).toBe(4);
    expect(scans.length).toBe(scansBefore);

    const missing = await summary(project.id, { ref: 'nope' });
    expect(missing.status).toBe(404);
  });

  it('改排除规则立即生效；成员页与提交列表', async () => {
    const { project, reverted } = await setUp();
    await t.call(updateTeamSettingsOp, { id: project.id, excludeGlobs: ['src/**'] });
    const { body } = await summary(project.id);
    expect(body.members.find((m) => m.key === 'zs@corp.com')?.metrics).toMatchObject({ added: 300, deleted: 0 });

    await t.call(updateTeamSettingsOp, { id: project.id, excludeGlobs: null, hugeCommitLines: 4 });
    const member = await t.call(teamMemberOp, { id: project.id, member: 'zs@corp.com', period: TeamPeriod.Last30Days });
    expect(member.status).toBe(200);
    expect(member.body.member.metrics).toMatchObject({ commits: 3, hugeCommits: 2, added: 2 });
    expect(member.body.identities.map((i) => i.email)).toEqual(['zs@corp.com']);

    const commits = await t.call(teamCommitsOp, {
      id: project.id,
      member: 'zs@corp.com',
      period: TeamPeriod.Last30Days,
    });
    expect(commits.body.items.map((c) => [c.subject, c.huge, c.reverted])).toEqual([
      ['feat: risky', true, true],
      ['chore: lock', false, false],
      ['feat: add a', true, false],
    ]);
    expect(commits.body.items[0]?.sha).toBe(reverted);

    const nobody = await t.call(teamMemberOp, { id: project.id, member: 'x@y.z', period: TeamPeriod.Last30Days });
    expect(nobody.status).toBe(404);
  });
});
