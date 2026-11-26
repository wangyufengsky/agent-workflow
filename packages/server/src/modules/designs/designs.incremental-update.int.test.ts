import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDesignOp,
  DesignSectionKind,
  ErrorCode,
  generateDesignOp,
  getDesignOp,
  getDesignStalenessOp,
  getGitReviewOp,
  InboxKind,
  incrementalUpdateDesignOp,
  McpToolName,
  OPENCODE_AGENT_NAME,
  PermissionDecision,
  resolveInboxOp,
  restoreDesignSectionOp,
  ServerEventType,
  startGitReviewOp,
  stopDesignOp,
  updateDesignOutlineOp,
} from '@aw/shared';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, inboxOpens } from '../../../test/helpers/tasks.ts';

const designer = { agent: OPENCODE_AGENT_NAME.designer };
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

function submission(sectionId: string, summary: string, relPath: string) {
  return {
    sectionId,
    summary,
    blocks: [{ type: 'markdown', markdown: summary }],
    files: [{ relPath, responsibility: summary, symbols: [] }],
    diagrams: [],
  };
}
function submit(sectionId: string, summary: string, path: string) {
  t.fake.enqueue(script().callTool(McpToolName.SubmitDesignSection, submission(sectionId, summary, path)), designer);
}
function finished(id: string, summary: string) {
  return waitForEvent(t.app.events, ServerEventType.DesignUpdated, ({ designId }) => {
    if (designId !== id) return false;
    const d = t.app.services.designs.get(id);
    return d.activeRunId === null && !d.handoffPending && d.sections.some((s) => s.summary === summary);
  });
}
async function fixture() {
  const names = ['orders', 'payments', 'catalog'];
  const { project, repo } = await addProject(t, {
    files: Object.fromEntries(names.map((n) => [`${n}/main.ts`, 'export const v = 1;\n'])),
  });
  await writeFile(join(repo.path, 'README.md'), '# Project\n');
  await repo.git('commit', '-am', 'Describe project');
  const { id } = (await t.call(createDesignOp, { projectId: project.id, aiReviewEnabled: false })).body;
  const draft = await t.call(updateDesignOutlineOp, {
    id,
    sections: names.map((name) => ({
      kind: DesignSectionKind.Module,
      title: name,
      scopePaths: [name],
    })),
  });
  expect(draft.status).toBe(200);
  const [orders, payments, catalog] = draft.body.sections;
  if (!orders || !payments || !catalog) throw new Error('Expected three chapters');
  for (const s of draft.body.sections) submit(s.id, s.title, `${s.title}/main.ts`);
  const ready = finished(id, catalog.title);
  expect((await t.call(generateDesignOp, { id })).status).toBe(200);
  await ready;
  return {
    id,
    projectId: project.id,
    repo,
    orders,
    payments,
    catalog,
    initial: (await t.call(getDesignOp, { id })).body,
  };
}

it('全选只更新受影响章节，处理新增与删除文件，可恢复旧章，历史提交审查保持原样', async () => {
  const { id, projectId, repo, orders, payments, catalog, initial } = await fixture();
  const sha = await repo.git('rev-parse', 'HEAD');
  t.fake.enqueue(
    script().callTool(McpToolName.SubmitFindings, { summary: '旧版本审查', findings: [], regression_checks: ['下单'] }),
    { agent: OPENCODE_AGENT_NAME.code_reviewer },
  );
  const review = await t.call(startGitReviewOp, { id: projectId, target: { kind: 'commit', sha } });
  expect(review.status).toBe(201);
  await t.fake.settled();
  const reviewId = review.body.id;
  const historical = (await t.call(getGitReviewOp, { reviewId })).body;
  expect(historical).toMatchObject({ designId: id, designSnapshotSha: sha, summary: '旧版本审查' });

  await rm(join(repo.path, 'orders/main.ts'));
  await writeFile(join(repo.path, 'orders/new.ts'), 'export const v = 2;\n');
  await writeFile(join(repo.path, 'payments/main.ts'), 'export const v = 2;\n');
  await repo.git('add', '-A');
  await repo.git('commit', '-m', 'Replace orders and change payments');
  const target = await repo.git('rev-parse', 'HEAD');
  const change = (await t.call(getDesignStalenessOp, { id })).body;
  expect(change.affectedSectionIds).toEqual([orders.id, payments.id]);
  submit(orders.id, '新版订单', 'orders/new.ts');
  submit(payments.id, '新版支付', 'payments/main.ts');
  const done = finished(id, '新版支付');
  expect(
    (await t.call(incrementalUpdateDesignOp, { id, sectionIds: change.affectedSectionIds, instruction: '核对新入口' }))
      .status,
  ).toBe(200);
  await done;
  const updated = (await t.call(getDesignOp, { id })).body;
  expect(updated.sourceSnapshot).toMatchObject({ commitSha: target, dirty: false });
  expect(updated.sections.find((s) => s.id === catalog.id)).toEqual(initial.sections.find((s) => s.id === catalog.id));
  expect(updated.runs.slice(initial.runs.length).map((r) => [r.isIncremental, r.doneSectionIds])).toEqual([
    [true, [orders.id]],
    [true, [payments.id]],
  ]);
  expect(updated.files.map((f) => f.relPath)).not.toContain('orders/main.ts');
  expect(updated.files.find((f) => f.relPath === 'orders/new.ts')).toMatchObject({
    sectionId: orders.id,
    responsibility: '新版订单',
  });
  expect((await t.call(getDesignStalenessOp, { id })).body).toMatchObject({ state: 'fresh', affectedSectionIds: [] });
  expect((await t.call(getGitReviewOp, { reviewId })).body).toEqual(historical);
  const restored = await t.call(restoreDesignSectionOp, { id, sectionId: orders.id });
  expect(restored.status).toBe(200);
  expect(restored.body.sections.find((s) => s.id === orders.id)).toMatchObject({
    summary: 'orders',
    hasPrevious: false,
  });
  expect(restored.body.files.find((f) => f.relPath === 'orders/main.ts')).toMatchObject({
    sectionId: orders.id,
    responsibility: 'orders',
  });
  expect((await t.call(getDesignStalenessOp, { id })).body).toMatchObject({
    state: 'stale',
    affectedSectionIds: [orders.id],
  });
});

it.each(['部分勾选', '停止', '失败'])('%s只保留已成功章节与旧全局基线，下次仅需更新剩余章节', async (mode) => {
  const { id, repo, orders, payments, initial } = await fixture();
  for (const dir of ['orders', 'payments']) await writeFile(join(repo.path, dir, 'main.ts'), 'export const v = 2;\n');
  submit(orders.id, '已更新订单', 'orders/main.ts');
  const waiting = mode === '停止' ? inboxOpens(t, InboxKind.Permission) : null;
  if (waiting) t.fake.enqueue(script().requestPermission('bash', ['rg v']).hang(), designer);
  if (mode === '失败') t.fake.enqueue(script().error('ContextOverflowError', '上下文不足'), designer);
  const done = mode === '停止' ? null : finished(id, '已更新订单');
  const sectionIds = mode === '部分勾选' ? [orders.id] : [orders.id, payments.id];
  expect((await t.call(incrementalUpdateDesignOp, { id, sectionIds })).status).toBe(200);
  if (waiting) {
    await waiting;
    const busy = await t.call(incrementalUpdateDesignOp, { id, sectionIds });
    expect(busy.raw.json().error.code).toBe(ErrorCode.DesignBusy);
    expect((await t.call(stopDesignOp, { id })).status).toBe(200);
  }
  await done;
  await t.fake.settled();
  const updated = (await t.call(getDesignOp, { id })).body;
  expect(updated.sourceSnapshot).toEqual(initial.sourceSnapshot);
  expect(updated.sections[0]).toMatchObject({ summary: '已更新订单', hasPrevious: true });
  expect(updated.sections[1]).toEqual(initial.sections[1]);
  expect((await t.call(getDesignStalenessOp, { id })).body).toMatchObject({
    state: 'stale',
    affectedSectionIds: [payments.id],
    changedPathsSample: ['payments/main.ts'],
  });
  const restored = await t.call(restoreDesignSectionOp, { id, sectionId: orders.id });
  expect(restored.body.sections[0]).toMatchObject({ summary: 'orders', hasPrevious: false });
});

it('运行期间 HEAD 前进和同文件再次编辑，全局只推进到启动时冻结的提交', async () => {
  const { id, repo, orders, payments } = await fixture();
  await writeFile(join(repo.path, 'orders/main.ts'), 'export const v = 2;\n');
  await repo.git('commit', '-am', 'Change orders');
  const target = await repo.git('rev-parse', 'HEAD');
  const waiting = inboxOpens(t, InboxKind.Permission);
  t.fake.enqueue(
    script()
      .requestPermission('bash', ['rg v'])
      .callTool(McpToolName.SubmitDesignSection, {
        ...submission(orders.id, '冻结的订单', 'orders/main.ts'),
        blocks: [
          {
            type: 'code',
            language: 'typescript',
            relPath: 'orders/main.ts',
            lineStart: 1,
            lineEnd: 1,
            code: 'export const v = 2;',
          },
        ],
      }),
    designer,
  );
  expect((await t.call(incrementalUpdateDesignOp, { id, sectionIds: [orders.id] })).status).toBe(200);
  const { item } = await waiting;
  for (const dir of ['orders', 'payments']) await writeFile(join(repo.path, dir, 'main.ts'), 'export const v = 3;\n');
  await repo.git('commit', '-am', 'Advance during update');
  const done = finished(id, '冻结的订单');
  expect((await t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Once } })).status).toBe(
    200,
  );
  await done;
  expect((await t.call(getDesignOp, { id })).body.sourceSnapshot).toMatchObject({ commitSha: target, dirty: false });
  expect((await t.call(getDesignStalenessOp, { id })).body).toMatchObject({
    state: 'stale',
    baseSha: target,
    headSha: await repo.git('rev-parse', 'HEAD'),
    affectedSectionIds: [orders.id, payments.id],
  });
});
