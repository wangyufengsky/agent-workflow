import { cp, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttemptKind,
  createProjectOp,
  createTeamAnalysesOp,
  getRuntimeOp,
  getTeamAnalysisOp,
  InboxKind,
  InboxStatus,
  resolveInboxOp,
  ServerEventType,
  TeamPeriod,
  updateSettingsOp,
} from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { createTestApp, type TestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

/** T-06: one real AI member analysis (33 §6) with the free test model on the `ts-stats` fixture. */
const TURN_TIMEOUT_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const AUTHOR = 'Zhang San <zs@corp.com>';

let t: TestApp;
let projectId: string;
const asked: string[] = [];

/** The fixture as one commit, then two commits of Zhang San in the last week: a feature and a fix. */
beforeAll(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
  const { body: runtime } = await t.call(getRuntimeOp, {});
  if (runtime.status !== 'ready') throw new Error(`opencode is not ready: ${runtime.status}`);
  await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aw-live-team-')));
  await cp(new URL('fixtures/ts-stats', import.meta.url).pathname, repo, { recursive: true });
  const git = (...args: string[]) =>
    runGit(['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com', ...args], { cwd: repo });
  const commit = async (daysAgo: number, message: string) => {
    await git('add', '-A');
    const date = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
    await git('commit', '-q', `--author=${AUTHOR}`, `--date=${date}`, '-m', message);
  };
  await git('init', '-q', '-b', 'main');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'init');
  const stats = join(repo, 'src/stats.ts');
  await writeFile(
    stats,
    `${await readFile(stats, 'utf8')}\nexport function range(values: number[]): number {\n  return Math.max(...values) - Math.min(...values);\n}\n`,
  );
  await commit(5, 'feat: add range');
  await writeFile(
    stats,
    (await readFile(stats, 'utf8')).replace(
      'return Math.max(...values) - Math.min(...values);',
      'if (values.length === 0) return 0;\n  return Math.max(...values) - Math.min(...values);',
    ),
  );
  await commit(3, 'fix: range of no values');
  projectId = (await t.call(createProjectOp, { repoPath: repo })).body.id;
  t.app.events.subscribe((event) => {
    if (event.type !== ServerEventType.InboxUpdated || event.data.item.status !== InboxStatus.Open) return;
    const { item } = event.data;
    if (item.kind !== InboxKind.Permission) return;
    asked.push(`${item.payload.permission}: ${item.payload.patterns.join(' | ')}`);
    void t.call(resolveInboxOp, { id: item.id, response: { decision: 'once' } });
  });
}, 60_000);
afterAll(() => t.close());

describe('@live 团队', () => {
  it(
    '成员分析：总结引用的都是这位成员的提交，抽样评审通过校验',
    async () => {
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        (d) => d.attempt.kind === AttemptKind.TeamAnalysis && d.attempt.endedAt !== null,
        TURN_TIMEOUT_MS,
      );
      const { body } = await t.call(createTeamAnalysesOp, {
        id: projectId,
        period: TeamPeriod.Last30Days,
        members: ['zs@corp.com'],
      });
      const started = body.items[0];
      if (started === undefined) throw new Error('no analysis');
      expect(started.sample).toHaveLength(2);
      await ended;

      const { body: analysis } = await t.call(getTeamAnalysisOp, { analysisId: started.id });
      console.log(
        JSON.stringify({ status: analysis.status, error: analysis.error, report: analysis.report, asked }, null, 2),
      );
      expect(analysis.status).toBe('succeeded');
      const cited = [
        ...(analysis.report?.work_items.flatMap((w) => w.commits) ?? []),
        ...(analysis.report?.strengths.flatMap((s) => s.commits) ?? []),
        ...(analysis.report?.concerns.flatMap((s) => s.commits) ?? []),
      ];
      expect(cited.length).toBeGreaterThan(0);
      const sampled = new Set(started.sample.map((s) => s.sha));
      for (const sha of cited) expect(sampled.has(sha)).toBe(true);
    },
    TURN_TIMEOUT_MS,
  );
});
