import {
  AppError,
  ErrorCode,
  getAttemptOp,
  getNodeOp,
  getTaskOp,
  getTaskTimelineOp,
  listInboxOp,
  readonlyBashRules,
  ServerEventType,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, finalVerify, planArgs, taskReaches } from '../../../test/helpers/tasks.ts';
import { runGit } from '../git/index.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  if (process.env.AW_DEBUG_LOGS) for (const l of t.logs) console.log(JSON.stringify(l).slice(0, 400));
  await t.close();
});

describe('只读角色执行的步骤', () => {
  it('代码审查步骤（评审者角色）的会话也可不经询问运行项目检查命令（D51、D61、D64）', async () => {
    const { project } = await addProject(t, { checkCommand: 'mvn -q test' });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'No issues' }), { title: '· 代码审查' });
    const review = taskReaches(t, 'review');
    await createTask(t, { projectId: project.id, workflow: 'code_review' });
    await review;
    const session = t.fake.sessions.find((s) => s.title.includes('· 代码审查'));
    expect(session?.agent).toBe('aw-reviewer');
    // What these rules allow and ask is covered by opencode.permissions.test.ts.
    expect(session?.permission).toEqual(readonlyBashRules(['mvn -q test']));
  });
});

it('开始命令等待模型超过 30 秒，耗尽配置时限后开发步骤获得单独的完整时限', async () => {
  const clock = createFakeClock();
  const isolated = await createTestApp({ clock });
  try {
    await isolated.call(updateSettingsOp, {
      'ai.sessionStartCommand': '/report start',
      'attempt.timeoutMinutes': 2,
      'node.maxAttempts': 1,
    });
    const { project } = await addProject(isolated, { checkCommand: null });
    const commandStarted = Promise.withResolvers<void>();
    vi.spyOn(isolated.fake, 'runCommand').mockImplementation(({ signal }) => {
      commandStarted.resolve();
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new AppError(ErrorCode.OpencodeRequestFailed)), { once: true });
      });
    });
    isolated.fake.enqueue(script().hang());
    const sent = waitForEvent(isolated.app.events, ServerEventType.AttemptTranscript, ({ entries }) =>
      entries.some((entry) => entry.kind === 'user_message' && entry.data.text.includes('Make a queue probe')),
    );
    await createTask(isolated, { projectId: project.id, workflow: 'frontend', requirement: 'Make a queue probe' });
    await commandStarted.promise;
    clock.advance(31_000);
    expect(isolated.fake.prompts).toHaveLength(0);

    clock.advance(89_000);
    const { attemptId } = await sent;
    clock.advance(119_000);
    expect((await isolated.call(getAttemptOp, { id: attemptId })).body.status).toBe('running');

    const failed = waitForEvent(
      isolated.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt }) => attempt.id === attemptId && attempt.status === 'failed',
    );
    clock.advance(1_000);
    expect((await failed).attempt.error?.code).toBe(ErrorCode.AttemptTimeout);
  } finally {
    await isolated.close();
  }
});

describe('任务主链路（新功能开发，简单模式）', () => {
  it('规划 → 并行执行两个步骤 → 整体验证（命令 + AI 评审）→ 待合并，结果卡含改动、检查与摘要', async () => {
    const { project } = await addProject(t, { checkCommand: 'test -f greet.ts' });
    t.fake.enqueue(
      script()
        .callTool('get_task_context')
        .callTool(
          'submit_plan',
          planArgs([{ key: 'api' }, { key: 'docs', role: 'tester' }, finalVerify(['api', 'docs'])], {
            assumptions: ['Greeting is English'],
          }),
        ),
      { agent: 'aw-planner' },
    );
    t.fake.enqueue(
      script()
        .edit('greet.ts', 'export const greet = () => "hi";\n')
        .callTool('submit_result', { summary: 'Added greet()', changes: [{ path: 'greet.ts', description: 'new' }] }),
      { title: '· api' },
    );
    t.fake.enqueue(script().edit('GREET.md', '# greet\n').callTool('submit_result', { summary: 'Documented' }), {
      title: '· docs',
    });
    t.fake.enqueue(script().callTool('submit_result', { summary: 'All checks pass' }), { title: '· 整体验证' });
    t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Complete' }), {
      agent: 'aw-reviewer',
    });

    const review = taskReaches(t, 'review');
    const created = await createTask(t, { projectId: project.id, workflow: 'feature' });
    expect(created).toMatchObject({ key: 'T-1', title: 'Add a greeting module', status: 'preparing' });
    await review;
    await t.fake.settled();

    const { body: task } = await t.call(getTaskOp, { id: created.id });
    expect(task).toMatchObject({ status: 'review', displayGroup: 'review', git: { worktreeStatus: 'ready' } });
    expect(task.nodes.map((n) => [n.key, n.status])).toEqual([
      ['api', 'done'],
      ['docs', 'done'],
      ['final_verify', 'done'],
    ]);
    expect(task.result).toMatchObject({
      filesChanged: 2,
      insertions: 2,
      deletions: 0,
      files: [
        { path: 'GREET.md', status: 'added' },
        { path: 'greet.ts', status: 'added' },
      ],
      assumptions: ['Greeting is English'],
      // Steps without their own acceptance run the workflow default: the project check.
      checks: [
        { nodeKey: 'api', kind: 'command', passed: true },
        { nodeKey: 'docs', kind: 'command', passed: true },
        { nodeKey: 'final_verify', kind: 'command', passed: true },
        { nodeKey: 'final_verify', kind: 'ai_review', passed: true },
      ],
    });
    expect(task.result?.nodeSummaries.map((s) => s.summary)).toEqual([
      'Added greet()',
      'Documented',
      'All checks pass',
    ]);
    expect((await t.call(listInboxOp, { taskId: task.id, status: 'open' })).body.items.map((i) => i.kind)).toEqual([
      'delivery',
    ]);

    // Finished nodes are committed by the backend on the task branch; the worktree is left clean.
    const worktree = task.git.worktreePath ?? '';
    const git = (...args: string[]) => runGit(args, { cwd: worktree }).then((r) => r.stdout.trim());
    expect(await git('status', '--porcelain')).toBe('');
    expect(await git('log', '--format=%an %s', `${task.git.baseCommit}..HEAD`)).toMatch(/^agent-workflow T-1 /);
    expect(await git('diff', '--name-only', `${task.git.baseCommit}..HEAD`)).toBe('GREET.md\ngreet.ts');
    const shas = await Promise.all(
      task.nodes.map(async (n) => (await t.call(getNodeOp, { id: task.id, nodeId: n.id })).body.commitSha),
    );
    expect(shas.filter((sha) => sha !== null)).not.toHaveLength(0);
    const api = task.nodes.find((n) => n.key === 'api');
    const { body: apiDetail } = await t.call(getNodeOp, { id: task.id, nodeId: api?.id ?? '' });
    expect(apiDetail.attempts.map((a) => [a.kind, a.status])).toEqual([['execute', 'succeeded']]);

    // The requirement and the required last step reached the sessions as specified.
    const planner = t.fake.sessions.find((s) => s.agent === 'aw-planner');
    expect(planner).toMatchObject({ title: 'T-1 · Add a greeting module', directory: worktree });
    // Read-only sessions run the project check without asking the user.
    const reviewer = t.fake.sessions.find((s) => s.agent === 'aw-reviewer');
    for (const session of [planner, reviewer]) {
      expect(session?.permission).toContainEqual({ permission: 'bash', pattern: 'test -f greet.ts*', action: 'allow' });
    }
    const verify = t.fake.prompts.find((p) => p.text.includes('Your step: 整体验证'));
    expect(verify?.system).toContain('Role: developer');
    const timeline = (await t.call(getTaskTimelineOp, { id: task.id })).body.items;
    expect(timeline.filter((e) => e.entity === 'task').map((e) => e.toStatus)).toEqual([
      'preparing',
      'planning',
      'running',
      'review',
    ]);
  });
});
