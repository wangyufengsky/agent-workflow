import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  decideRequirementOp,
  ErrorCode,
  getRequirementsOp,
  getTaskOp,
  replaceRequirementsOp,
  requestChangesOp,
  startTaskOp,
  TaskStatus,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

it('拒绝越出审查范围的定位，并将删除行固定到当时的旧提交', async () => {
  const path = 'check.ts';
  const { project, repo } = await addProject(t, { files: { [path]: 'export const allowed = checkRole();\n' } });
  const from = await repo.git('rev-parse', 'HEAD');
  await writeFile(join(repo.path, path), 'export const allowed = true;\n');
  await repo.git('commit', '-am', 'removed checks');
  const to = await repo.git('rev-parse', 'HEAD');
  const finding = {
    path,
    title: '权限检查丢失',
    severity: 'blocker',
    category: 'security',
    description: '调用方可能访问未授权的数据。',
    line: 1,
    side: 'old',
  };
  const submit = (override: object) => ({
    summary: '权限规则被改动。',
    code_review: { scope: { kind: 'diff', from, to }, findings: [{ ...finding, ...override }] },
  });
  const task = await createTask(t, { projectId: project.id, workflow: 'code_review', start: false });
  t.fake.enqueue(
    script()
      .callTool('submit_result', submit({ path: 'README.md' }))
      .callTool('submit_result', submit({ line: 99 }))
      .callTool('submit_result', submit({})),
    { title: '· 代码审查', directory: `/${task.key}` },
  );
  const ready = taskReaches(t, TaskStatus.Review);
  await t.call(startTaskOp, { id: task.id });
  await ready;
  expect(t.fake.toolCalls.filter((call) => call.isError).map((call) => call.result)).toMatchObject([
    {
      code: ErrorCode.GitReviewFindingsInvalid,
      guide: { tool: 'submit_result', example: { code_review: { scope: { kind: 'diff', from, to } } } },
    },
    { code: ErrorCode.GitReviewFindingsInvalid },
  ]);
  expect((await t.call(getTaskOp, { id: task.id })).body.codeReview).toMatchObject({
    report: { scope: { kind: 'diff', from, to }, findings: [{ ...finding, location: { commit: from, path } }] },
  });

  // A user conclusion about the first report does not verify the revised report at the same commit.
  const checklist = await t.call(replaceRequirementsOp, {
    id: task.id,
    items: [{ title: '复核权限影响', expected: '逐条确认', verification: { kind: 'manual' } }],
  });
  const item = checklist.body.items[0];
  if (item === undefined) throw new Error('Expected a checklist item');
  const checked = await t.call(decideRequirementOp, {
    id: task.id,
    itemId: item.id,
    conclusion: 'pass',
    note: '已确认首版。',
  });
  expect(checked.body.items[0]?.status).toBe('passed');
  t.fake.enqueue(script().callTool('submit_result', { summary: '请人工核对修订后的报告。' }), {
    title: '· 核验验收清单',
    directory: `/${task.key}`,
  });
  t.fake.enqueue(
    script()
      .callTool('submit_result', {
        summary: '重新核对后撤回误报。',
        code_review: { scope: { kind: 'diff', from, to }, findings: [] },
      })
      .callTool('submit_result', { summary: '旧版兼容总结' }),
    { title: '· 按反馈修改', directory: `/${task.key}` },
  );
  const revised = taskReaches(t, TaskStatus.Review);
  const response = await t.call(requestChangesOp, {
    id: task.id,
    reason: 'user',
    feedback: '重新核对权限规则和上下文。',
  });
  expect(response.status).toBe(200);
  await revised;
  const revisedSession = t.fake.sessions.find(({ title }) => title.includes('· 按反馈修改'));
  expect(revisedSession?.agent).toBe('aw-reviewer');
  expect((await t.call(getTaskOp, { id: task.id })).body.codeReview).toEqual({
    summary: '重新核对后撤回误报。',
    report: { scope: { kind: 'diff', from, to }, findings: [] },
  });
  const requirements = (await t.call(getRequirementsOp, { id: task.id })).body;
  expect(requirements.commitSha).toBe(checked.body.commitSha);
  expect(requirements.items[0]?.status).toBe('stale');
});
