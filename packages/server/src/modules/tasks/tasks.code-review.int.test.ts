import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorCode, getTaskOp, startTaskOp, TaskStatus } from '@aw/shared';
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
    { code: ErrorCode.GitReviewFindingsInvalid },
    { code: ErrorCode.GitReviewFindingsInvalid },
  ]);
  expect((await t.call(getTaskOp, { id: task.id })).body.codeReview).toMatchObject({
    report: { scope: { kind: 'diff', from, to }, findings: [{ ...finding, location: { commit: from, path } }] },
  });
});
