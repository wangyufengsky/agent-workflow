import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, getAttemptOp, ServerEventType, startDebugAttemptOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo, type TestRepo } from '../../../test/helpers/git.ts';

let t: TestApp;
let repo: TestRepo;
beforeEach(async () => {
  t = await createTestApp();
  repo = await createTestRepo();
});
afterEach(() => t.close());

describe('调试尝试与 M2 的 MCP 工具', () => {
  it('get_task_context 返回调试需求与工作目录；report_progress 推送当前进展；submit_result 结束尝试', async () => {
    t.fake.enqueue(
      script()
        .callTool('get_task_context')
        .callTool('report_progress', { message: 'Writing the greeting' })
        .callTool('submit_result', { summary: 'Added a greeting' }),
    );
    const progressed = waitForEvent(t.app.events, ServerEventType.AttemptUpdated, (d) => d.attempt.progress !== null);
    const succeeded = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.status === 'succeeded',
    );
    const { body: attempt } = await t.call(startDebugAttemptOp, {
      directory: repo.path,
      requirement: 'Add a greeting\nIt should say hi.',
      model: 'opencode/fake-model',
    });
    expect((await progressed).attempt.progress).toBe('Writing the greeting');
    expect((await succeeded).attempt.progress).toBeNull();
    await t.fake.settled();

    const head = (await repo.git('rev-parse', 'HEAD')).trim();
    expect(t.fake.toolCalls.map((c) => [c.name, c.isError])).toEqual([
      ['get_task_context', false],
      ['report_progress', false],
      ['submit_result', false],
    ]);
    expect(t.fake.toolCalls[0]?.result).toMatchObject({
      task: { key: 'DEBUG', title: 'Add a greeting', requirement: 'Add a greeting\nIt should say hi.' },
      workspace: { path: repo.path, branch: 'main', baseCommit: head },
      attempt: { kind: 'execute', seq: 1 },
      askOnUncertainty: false,
    });
    expect(t.fake.sessions[0]).toMatchObject({
      directory: repo.path,
      title: 'DEBUG · Add a greeting',
      agent: 'aw-executor',
    });
    expect(t.fake.prompts[0]).toMatchObject({ model: { providerId: 'opencode', modelId: 'fake-model' } });
    expect((await t.call(getAttemptOp, { id: attempt.id })).body).toMatchObject({
      status: 'succeeded',
      model: 'opencode/fake-model',
    });
  });

  it('重复提交结果返回 MCP_RESULT_ALREADY_SUBMITTED', async () => {
    t.fake.enqueue(script().callTool('submit_result', { summary: 'one' }));
    const succeeded = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.status === 'succeeded',
    );
    await t.call(startDebugAttemptOp, { directory: repo.path, requirement: 'x' });
    await succeeded;
    // The backend stops the turn after a submit; a model resuming the session would submit again.
    await t.fake.settled();
    const session = t.fake.sessions[0]?.id ?? '';
    t.fake.enqueue(script().callTool('submit_result', { summary: 'two' }));
    await t.fake.prompt({ sessionId: session, directory: repo.path, agent: 'aw-executor', text: 'again' });
    await t.fake.settled();
    expect(t.fake.toolCalls.at(-1)).toMatchObject({
      isError: true,
      result: { code: ErrorCode.McpResultAlreadySubmitted },
    });
  });

  it('目录不在 Git 仓库中时返回 400 PROJECT_PATH_NOT_GIT_REPO', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'aw-plain-'));
    for (const directory of [plain, join(plain, 'missing')]) {
      const res = await t.call(startDebugAttemptOp, { directory, requirement: 'x' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: ErrorCode.ProjectPathNotGitRepo } });
    }
  });
});
