import { ErrorCode, nodeDiffFileOp, nodeDiffOp, taskDiffFileOp, taskDiffOp } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { addProject, taskInReview } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

describe('任务与步骤的 diff', () => {
  it('任务 diff 相对基线：文件列表与单文件；步骤 diff 为其提交的改动，未提交的步骤没有改动', async () => {
    const { repo, project } = await addProject(t, { files: { 'greet.ts': 'export const hi = "hi";\n' } });
    const task = await taskInReview(t, project.id, { 'greet.ts': 'export const hi = "hello";\n', 'NOTE.md': 'n\n' });
    const base = (await repo.git('rev-parse', 'main')).trim();

    const { body: diff } = await t.call(taskDiffOp, { id: task.id });
    expect(diff).toEqual({
      base,
      files: [
        { path: 'NOTE.md', status: 'added', additions: 1, deletions: 0 },
        { path: 'greet.ts', status: 'modified', additions: 1, deletions: 1 },
      ],
    });
    const { body: file } = await t.call(taskDiffFileOp, { id: task.id, path: 'greet.ts' });
    expect('diff' in file && file.diff).toContain('-export const hi = "hi";\n+export const hi = "hello";\n');

    const [locate, fix] = task.nodes;
    expect((await t.call(nodeDiffOp, { id: task.id, nodeId: locate?.id ?? '' })).body).toEqual({
      base: null,
      files: [],
    });
    const { body: fixDiff } = await t.call(nodeDiffOp, { id: task.id, nodeId: fix?.id ?? '' });
    expect(fixDiff).toMatchObject({ base, files: [{ path: 'NOTE.md' }, { path: 'greet.ts' }] });
    const { body: fixFile } = await t.call(nodeDiffFileOp, { id: task.id, nodeId: fix?.id ?? '', path: 'NOTE.md' });
    expect('diff' in fixFile && fixFile.diff).toContain('+n\n');
    const none = await t.call(nodeDiffFileOp, { id: task.id, nodeId: locate?.id ?? '', path: 'NOTE.md' });
    expect([none.status, none.raw.json().error.code]).toEqual([404, ErrorCode.NotFound]);
  });
});
