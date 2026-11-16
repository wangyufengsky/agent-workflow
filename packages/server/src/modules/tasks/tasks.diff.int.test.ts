import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  deliverTaskOp,
  ErrorCode,
  nodeDiffFileOp,
  nodeDiffOp,
  taskCheckEvidenceOp,
  taskDiffFileOp,
  taskDiffOp,
} from '@aw/shared';
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
  it.each(['squash', 'merge', 'rebase'] as const)('%s 交付后的 diff 固定在交付前后提交', async (strategy) => {
    const { repo, project } = await addProject(t, { files: { 'greet.ts': 'old\n' } });
    const task = await taskInReview(t, project.id, { 'greet.ts': 'new\n' });
    await writeFile(join(repo.path, 'before.txt'), 'before\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-qm', 'before delivery');
    const base = (await repo.git('rev-parse', 'main')).trim();
    const delivered = await t.call(deliverTaskOp, { id: task.id, strategy });
    expect(delivered.body.lastDelivery).toMatchObject({
      diffBase: base,
      diffHead: delivered.body.lastDelivery?.commitSha,
    });
    await writeFile(join(repo.path, 'after.txt'), 'after\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-qm', 'after delivery');
    const diff = await t.call(taskDiffOp, { id: task.id });
    expect(diff.body).toMatchObject({ base, files: [{ path: 'greet.ts' }] });
    const file = await t.call(taskDiffFileOp, { id: task.id, path: 'greet.ts' });
    expect('diff' in file.body && file.body.diff).toContain('-old\n+new');
  });

  it('结果只返回证据索引，按索引读取当次检查快照，不接受其他索引', async () => {
    const { project } = await addProject(t, { files: { 'greet.ts': 'old\n' } });
    const task = await taskInReview(t, project.id, { 'greet.ts': 'new\n' });
    const check = task.result?.checks.find((item) => item.evidenceId !== undefined);
    expect(check?.evidence).toBeUndefined();
    expect(check?.evidenceId).toBeDefined();
    const evidence = await t.call(taskCheckEvidenceOp, { id: task.id, evidenceId: check?.evidenceId ?? '' });
    expect(evidence.status).toBe(200);
    expect(evidence.body).toMatchObject({ kind: check?.kind, passed: check?.passed });
    expect((await t.call(taskCheckEvidenceOp, { id: task.id, evidenceId: 'missing' })).status).toBe(404);
  });
  it('旧交付缺少范围时返回明确的不可用原因', async () => {
    const { repo, project } = await addProject(t, { files: { 'greet.ts': 'old\n' } });
    const task = await taskInReview(t, project.id, { 'greet.ts': 'new\n' });
    await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    const db = new DatabaseSync(join(t.dataDir, 'app.db'));
    db.prepare('UPDATE deliveries SET diff_base = NULL, diff_head = NULL WHERE task_id = ?').run(task.id);
    db.close();
    const diff = await t.call(taskDiffOp, { id: task.id });
    expect(diff.status).toBe(404);
    expect(diff.raw.json().error).toMatchObject({
      message: 'Delivery diff range is unavailable',
      details: { reason: 'delivery_range_unavailable' },
    });
    const missing = new DatabaseSync(join(t.dataDir, 'app.db'));
    missing
      .prepare('UPDATE deliveries SET diff_base = ?, diff_head = ? WHERE task_id = ?')
      .run('a'.repeat(40), 'b'.repeat(40), task.id);
    missing.close();
    expect((await t.call(taskDiffOp, { id: task.id })).status).toBe(404);
    await rename(join(repo.path, '.git'), join(repo.path, '.git-away'));
    try {
      const failed = await t.call(taskDiffOp, { id: task.id });
      expect(failed.raw.json().error.code).toBe(ErrorCode.GitCommandFailed);
    } finally {
      await rename(join(repo.path, '.git-away'), join(repo.path, '.git'));
    }
  });
});
