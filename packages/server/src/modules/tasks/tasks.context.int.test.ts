import { ErrorCode } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, finalVerify, planArgs, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const results = (name: string) => t.fake.toolCalls.filter((c) => c.name === name);

describe('任务上下文类 MCP 工具（12 §6.1–6.3）', () => {
  it('规划、执行、评审会话各自得到对应的上下文；读取已完成步骤的产出与任务改动', async () => {
    const { project } = await addProject(t, { checkCommand: null });
    t.fake.enqueue(
      script()
        .callTool('get_task_context')
        .callTool('get_task_diff')
        .callTool('submit_plan', planArgs([{ key: 'a' }, { key: 'b', depends_on: ['a'] }, finalVerify(['b'])])),
      { agent: 'aw-planner' },
    );
    t.fake.enqueue(
      script()
        .edit('a.txt', 'one\n')
        .callTool('submit_result', {
          summary: 'Wrote a',
          changes: [{ path: 'a.txt', description: 'new file' }],
          notes: 'b must read a.txt',
          assumptions: ['UTF-8'],
        }),
      { title: '· a' },
    );
    t.fake.enqueue(
      script()
        .edit('b.txt', 'two\n')
        .callTool('get_task_context')
        .callTool('get_node_output', { node_key: 'a' })
        .callTool('get_node_output', { node_key: 'final_verify' })
        .callTool('get_task_diff')
        .callTool('get_task_diff', { path: '' })
        .callTool('get_task_diff', { path: 'b.txt' })
        .callTool('get_task_diff', { path: 'nope.txt' })
        .callTool('submit_result', { summary: 'Wrote b' }),
      { title: '· b' },
    );
    t.fake.enqueue(script().callTool('submit_result', { summary: 'Verified' }), { title: '· 整体验证' });
    t.fake.enqueue(
      script()
        .callTool('get_task_context')
        .callTool('ask_user', { question: 'Sure?', blocking: true })
        .callTool('submit_review', { verdict: 'pass', summary: 'ok' }),
      { agent: 'aw-reviewer' },
    );
    const review = taskReaches(t, 'review');
    const task = await createTask(t, { projectId: project.id, workflow: 'feature' });
    await review;
    await t.fake.settled();

    const [planContext, executeContext, reviewContext] = results('get_task_context').map((c) => c.result);
    expect(planContext).toMatchObject({
      task: { key: 'T-1', workflow: '新功能开发', deliverable: 'code_changes' },
      attempt: { kind: 'plan', seq: 1 },
      planning: {
        guidance: expect.stringContaining('final_verify'),
        allowedRoles: [
          { key: 'developer', name: '开发工程师' },
          { key: 'tester', name: '测试工程师' },
        ],
        requiredSteps: [{ key: 'final_verify', roleKey: 'developer' }],
        maxNodes: 20,
      },
      upstream: [],
    });
    expect(planContext).not.toHaveProperty('plan');
    expect(executeContext).toMatchObject({
      attempt: { kind: 'execute' },
      node: { key: 'b', dependsOn: ['a'], acceptance: { checks: [], manual: false } },
      plan: {
        version: 1,
        nodes: [
          { key: 'a', status: 'done', resultSummary: 'Wrote a' },
          { key: 'b', status: 'running' },
          { key: 'final_verify', status: 'pending' },
        ],
      },
      upstream: [{ key: 'a', summary: 'Wrote a', changedFiles: ['a.txt'] }],
    });
    expect(reviewContext).toMatchObject({ attempt: { kind: 'review' }, node: { key: 'final_verify' } });
    expect(results('ask_user')[0]?.result).toMatchObject({ code: ErrorCode.McpToolNotAllowed });

    const [output, missing] = results('get_node_output').map((c) => c.result);
    expect(output).toEqual({
      key: 'a',
      title: 'a',
      summary: 'Wrote a',
      changes: [{ path: 'a.txt', description: 'new file' }],
      notes: 'b must read a.txt',
      assumptions: ['UTF-8'],
      checkResults: [],
    });
    expect(missing).toMatchObject({ code: ErrorCode.McpNodeNotFound, hint: expect.stringContaining('finished step') });

    const [planDiff, files, emptyPath, one, unknown] = results('get_task_diff');
    expect(planDiff?.result).toMatchObject({ code: ErrorCode.McpToolNotAllowed });
    // a.txt is committed, b.txt not yet: both count against the base commit.
    expect(files?.result).toEqual({
      files: [
        { path: 'a.txt', status: 'added', additions: 1, deletions: 0 },
        { path: 'b.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    });
    // Models that fill every argument send an empty path to mean「all files」.
    expect(emptyPath?.result).toEqual(files?.result);
    expect(one?.result).toMatchObject({ path: 'b.txt', diff: expect.stringContaining('+two') });
    expect(unknown?.result).toMatchObject({
      code: ErrorCode.ValidationFailed,
      hint: expect.stringContaining('without path'),
    });
    expect(task.key).toBe('T-1');
  });
});
