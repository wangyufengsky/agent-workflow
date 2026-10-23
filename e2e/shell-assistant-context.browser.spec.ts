import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

test('任务详情快照可预览移除，与文件一起随侧栏消息发送', async ({ page, request }, testInfo) => {
  const project = await createProject(request, null);
  const workflows: { items: { id: string; key: string }[] } = await (
    await request.get(`${API_BASE}/workflows`, { headers: AUTH })
  ).json();
  const workflow = workflows.items.find((item) => item.key === 'feature');
  if (workflow === undefined) throw new Error('Missing feature workflow');
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: {
      projectId: project.id,
      workflowId: workflow.id,
      requirement: '导出订单时保留前导零',
      start: false,
    },
  });
  expect(created.ok()).toBe(true);
  const task: { id: string; key: string } = await created.json();
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole('heading', { name: '导出订单时保留前导零' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByRole('complementary', { name: '应用助手' });
  const snapshotName = `${task.key}-任务上下文.txt`;
  await panel.getByRole('button', { name: '附上任务详情', exact: true }).click();
  const preview = page.getByRole('dialog', { name: snapshotName });
  await expect(preview).toContainText('导出订单时保留前导零');
  await expect(preview).toContainText('采集时间：');
  await page.screenshot({ path: testInfo.outputPath('context-light.png') });
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  const attachments = panel.getByRole('list', { name: '附加的资料' });
  await attachments.getByRole('button', { name: `移除 ${snapshotName}` }).click();
  await expect(attachments).toBeHidden();

  await panel.getByRole('button', { name: '附上任务详情', exact: true }).click();
  await expect(preview).toContainText('导出订单时保留前导零');
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  await panel.locator('input[type="file"]').setInputFiles({
    name: '说明.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('只影响 CSV 导出'),
  });
  await expect(attachments.getByRole('button', { name: '查看 说明.txt' })).toBeVisible();
  await queueAssistantTurn(request, [{ type: 'text', text: '我会结合任务快照和补充说明检查。' }]);
  await panel.getByLabel('发给助手的消息').fill('帮我解释当前任务');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/messages'));
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  expect((await sent).postDataJSON().attachmentIds).toHaveLength(2);
  await expect(panel).toContainText('我会结合任务快照和补充说明检查。');
  // 已发送的资料仍显示在消息下；输入草稿里的移除入口应清空。
  await expect(panel.getByRole('button', { name: `移除 ${snapshotName}` })).toBeHidden();
  await expect(panel.getByRole('button', { name: '移除 说明.txt' })).toBeHidden();
  await panel.getByRole('button', { name: `查看 ${snapshotName}` }).click();
  await expect(preview).toContainText('内容固定为采集时版本');
});

test('主页显式选中文字可修改后附上；开始任务模式不显示助手上下文入口', async ({ page, request }, testInfo) => {
  await createProject(request, null);
  await page.goto('/');
  const selected = page.getByText('万事皆流程，执行由你掌控。', { exact: true });
  await expect(selected).toBeVisible();
  await selected.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: '附上选中文字', exact: true }).click();
  const input = page.getByRole('dialog', { name: '附上文字', exact: true });
  await expect(input.getByLabel('要附上的文字')).toHaveValue('万事皆流程，执行由你掌控。');
  await input.getByLabel('要附上的文字').fill('订单导出仍然丢失前导零');
  await input.getByRole('button', { name: '添加到消息' }).click();
  const preview = page.getByRole('dialog', { name: '选中文字.txt', exact: true });
  await expect(preview).toContainText('订单导出仍然丢失前导零');
  await expect(preview).toContainText('用户选取或粘贴的文字');
  await patchSettings(request, { 'ui.theme': 'deepseek' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'deepseek');
  await page.screenshot({ path: testInfo.outputPath('context-dark.png') });
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  await queueAssistantTurn(request, [{ type: 'text', text: '已读取你附上的这段文字。' }]);
  await page.getByLabel('告诉助手，或开始任务').fill('看看这个错误');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('已读取你附上的这段文字。')).toBeVisible();
  await page.getByRole('button', { name: '查看 选中文字.txt' }).click();
  await expect(preview).toContainText('订单导出仍然丢失前导零');
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('group', { name: '直接开始' })
    .getByRole('button', { name: /修 Bug/ })
    .click();
  await expect(page.getByRole('button', { name: '附上选中文字', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '改为问助手' }).click();
  await expect(page.getByRole('button', { name: '附上选中文字', exact: true })).toBeVisible();
});

test('生成中的文字快照被移除后，迟到的响应不会重开预览或带入消息', async ({ page, request }) => {
  await createProject(request, null);
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/assistant/context-snapshots', async (route) => {
    const response = await route.fetch();
    received.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '附上选中文字', exact: true }).click();
  await page.getByLabel('要附上的文字').fill('这段文字不发送');
  await page.getByRole('button', { name: '添加到消息' }).click();
  await received.promise;
  await page.getByRole('button', { name: '移除 选中文字.txt' }).click();
  const response = page.waitForResponse((r) => r.url().includes('/assistant/context-snapshots'));
  release.resolve();
  await (await response).finished();
  await queueAssistantTurn(request, [{ type: 'text', text: '消息没有附加资料。' }]);
  await page.getByLabel('告诉助手，或开始任务').fill('移除后不发送资料');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/messages'));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  expect((await sent).postDataJSON().attachmentIds).toBeUndefined();
  await expect(page.getByText('消息没有附加资料。')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '选中文字.txt', exact: true })).toBeHidden();
});
