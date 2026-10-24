import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  cancelTeamAnalysisOp,
  createTeamAnalysesOp,
  ErrorCode,
  getTeamAnalysisOp,
  ServerEventType,
  TeamAnalysisProblemCode,
  TeamPeriod,
  teamSummaryOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import type { TestRepo } from '../../../test/helpers/git.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

const REVIEWER = { agent: 'aw-code-reviewer' };
const DAY_MS = 86_400_000;

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

async function commitAs(
  repo: TestRepo,
  author: string,
  daysAgo: number,
  message: string,
  files: Record<string, string>,
) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo.path, file)), { recursive: true });
    await writeFile(join(repo.path, file), content);
  }
  await repo.git('add', '-A');
  const date = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  await repo.git('commit', '-q', `--author=${author}`, `--date=${date}`, '-m', message);
  return (await repo.git('rev-parse', 'HEAD')).trim();
}

const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n')}\n`;

/** Zhang San's small and big commits, and one of Li Si. */
async function setUp() {
  const { repo, project } = await addProject(t);
  const small = await commitAs(repo, 'Zhang San <zs@corp.com>', 5, 'feat: small', { 'src/a.ts': lines(3) });
  const big = await commitAs(repo, 'Zhang San <zs@corp.com>', 4, 'feat: big', { 'src/b.ts': lines(20) });
  const li = await commitAs(repo, 'Li Si <ls@corp.com>', 3, 'fix: c', { 'src/c.ts': lines(4) });
  return { repo, project, small, big, li };
}

const ENDED = ['succeeded', 'failed', 'aborted', 'interrupted'];

/** Subscribe before the action: resolves once `count` analysis sessions ended (each analysis is ended by then). */
function sessionsEnd(count: number): Promise<void> {
  let ended = 0;
  return new Promise((resolve) => {
    const unsubscribe = t.app.events.subscribe((e) => {
      if (e.type !== ServerEventType.AttemptUpdated || e.data.attempt.kind !== 'team_analysis') return;
      if (!ENDED.includes(e.data.attempt.status)) return;
      ended += 1;
      if (ended === count) {
        unsubscribe();
        resolve();
      }
    });
  });
}

const range = { period: TeamPeriod.Last30Days } as const;

describe('AI 成员分析（33 §6）', () => {
  it('只读会话总结工作并评审抽样提交；引用不对时退回让 AI 修正；排队依次运行；概览带抽样评审的数字', async () => {
    const { project, small, big, li } = await setUp();
    const finding = { severity: 'major', category: 'correctness', title: 'Magic numbers', description: 'Why 19?' };
    const analysis = (commit: string, path: string, line: number) => ({
      summary: '做了两件小事。',
      work_items: [{ title: '新增 a 与 b', description: '两个模块', commits: [small, big] }],
      strengths: [{ text: '提交小而清楚', commits: [small] }],
      concerns: [],
      findings: [{ ...finding, commit, path, line }],
    });
    t.fake.enqueue(
      script()
        // Li Si's commit is not Zhang San's; the README is not in the commit; line 40 is past its end.
        .callTool('submit_member_analysis', {
          ...analysis(big, 'README.md', 1),
          work_items: [{ title: 'x', description: 'y', commits: [li] }],
        })
        .callTool('submit_member_analysis', analysis(big, 'src/b.ts', 40))
        .callTool('submit_member_analysis', analysis(big, 'src/b.ts', 19)),
      REVIEWER,
    );
    t.fake.enqueue(
      script().callTool('submit_member_analysis', {
        summary: '修了一个问题。',
        work_items: [{ title: '修复 c', description: 'c', commits: [li] }],
        strengths: [],
        concerns: [],
        findings: [],
      }),
      REVIEWER,
    );

    const both = sessionsEnd(2);
    const { status, body } = await t.call(createTeamAnalysesOp, {
      id: project.id,
      ...range,
      members: ['zs@corp.com', 'LS@corp.com'],
    });
    expect(status).toBe(201);
    const [zs, ls] = body.items;
    if (zs === undefined || ls === undefined) throw new Error('two analyses expected');
    // The largest commits first; the second analysis waits for the first.
    expect(zs.sample.map((s) => s.sha)).toEqual([big, small]);
    expect([zs.status, ls.status]).toEqual(['running', 'queued']);
    const again = await t.call(createTeamAnalysesOp, { id: project.id, ...range, members: ['ls@corp.com'] });
    expect(again.raw.json().error.code).toBe(ErrorCode.TeamAnalysisExists);

    await both;
    const done = async (id: string) => (await t.call(getTeamAnalysisOp, { analysisId: id })).body;
    expect((await done(ls.id)).status).toBe('succeeded');

    const calls = t.fake.toolCalls.filter((c) => c.name === 'submit_member_analysis');
    const codes = (i: number) => {
      const result = calls[i]?.result as { details?: { problems: { code: string }[] } } | undefined;
      return (result?.details?.problems ?? []).map((p) => p.code);
    };
    expect(codes(0)).toEqual([TeamAnalysisProblemCode.CommitNotInPeriod, TeamAnalysisProblemCode.PathNotInCommit]);
    expect(codes(1)).toEqual([TeamAnalysisProblemCode.LineOutOfRange]);
    const prompt = t.fake.prompts.find((p) => p.text.includes('Zhang San'))?.text ?? '';
    expect(prompt).toContain(`${big} (20 lines) feat: big`);
    expect(prompt).not.toContain(li);
    expect(t.fake.sessions[0]).toMatchObject({ agent: 'aw-code-reviewer', directory: project.repoPath });

    const zsDone = await done(zs.id);
    expect(zsDone).toMatchObject({ status: 'succeeded', report: { summary: '做了两件小事。' } });
    expect(zsDone.quality).toMatchObject({ sampledLines: 23, major: 1, perKloc: { major: 1000 / 23 } });
    const { body: summary } = await t.call(teamSummaryOp, { id: project.id, ...range });
    expect(summary.analyses.map((a) => [a.member, a.status])).toEqual(
      expect.arrayContaining([
        ['zs@corp.com', 'succeeded'],
        ['ls@corp.com', 'succeeded'],
      ]),
    );
  });

  it('取消排队中与运行中的分析；另一分支可同时排队；没有提交的成员被拒；会话没有提交就结束时分析失败', async () => {
    const { repo, project } = await setUp();
    t.fake.enqueue(script().hang(), REVIEWER);
    const { body } = await t.call(createTeamAnalysesOp, {
      id: project.id,
      ...range,
      members: ['zs@corp.com', 'ls@corp.com'],
    });
    const [zs, ls] = body.items;
    if (zs === undefined || ls === undefined) throw new Error('two analyses expected');

    // Another branch is another analysis, even while this one waits.
    await repo.git('branch', 'other');
    const other = await t.call(createTeamAnalysesOp, {
      id: project.id,
      ...range,
      ref: 'other',
      members: ['ls@corp.com'],
    });
    expect(other.status).toBe(201);
    // Nothing to analyse: a member without commits in the range is refused before any session starts.
    const nobody = await t.call(createTeamAnalysesOp, {
      id: project.id,
      period: TeamPeriod.Custom,
      from: '2020-01-01',
      to: '2020-01-31',
      members: ['zs@corp.com'],
    });
    expect(nobody.raw.json().error.code).toBe(ErrorCode.ValidationFailed);
    const otherId = other.body.items[0]?.id ?? '';
    expect((await t.call(cancelTeamAnalysisOp, { analysisId: otherId })).body.status).toBe('cancelled');

    expect((await t.call(cancelTeamAnalysisOp, { analysisId: ls.id })).body.status).toBe('cancelled');
    const cancelled = await t.call(cancelTeamAnalysisOp, { analysisId: zs.id });
    expect(cancelled.body.status).toBe('cancelled');
    await t.fake.settled();

    // A session that ends without submitting fails its analysis.
    t.fake.enqueue(script().text('我不想提交'), REVIEWER);
    const ended = sessionsEnd(1);
    const failing = (await t.call(createTeamAnalysesOp, { id: project.id, ...range, members: ['zs@corp.com'] })).body
      .items[0];
    if (failing === undefined) throw new Error('one analysis expected');
    await ended;
    expect((await t.call(getTeamAnalysisOp, { analysisId: failing.id })).body.status).toBe('failed');
  });
});
