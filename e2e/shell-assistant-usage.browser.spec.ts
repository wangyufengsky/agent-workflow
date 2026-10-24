import { expect, type Page } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

/**
 * Usage sits behind the input's「助手用量」button (36 §3): open it and read the popover. Typing does not close it, and
 * pressing the button of an open popover would toggle it shut, so it is only pressed while closed.
 */
async function openUsage(page: Page) {
  const usage = page.getByRole('dialog', { name: '助手用量' });
  if (!(await usage.isVisible())) await page.getByRole('button', { name: '助手用量', exact: true }).click();
  await expect(usage).toBeVisible();
  return usage;
}

test('主页、侧栏与桌宠共享真实用量；未报告与实际零值分别显示', async ({ page, request }, testInfo) => {
  await createProject(request, null);
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
  await queueAssistantTurn(request, [
    { type: 'usage', input: 37, output: 11 },
    { type: 'text', text: '本轮用量已记录。' },
  ]);
  await page.goto('/');
  const homeInput = page.getByLabel('告诉助手，或开始任务');
  await homeInput.fill('请记录这一轮');
  await homeInput.press('ControlOrMeta+Enter');
  let usage = await openUsage(page);
  await expect(usage).toContainText('已完成');
  await expect(usage).toContainText('输入 37 · 输出 11 tokens');
  await expect(usage).toContainText('会话累计已报告 48 tokens');
  await expect(usage).toContainText('此前未知');
  await expect(usage).toContainText('时限 60 分钟（不含权限等待）');

  // 通过站内导航保留当前对话，侧栏复用同一份用量。
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+j');
  usage = await openUsage(page);
  await expect(usage).toContainText('输入 37 · 输出 11 tokens');
  await queueAssistantTurn(request, [
    { type: 'text', text: '这轮尚未报告用量。' },
    { type: 'hang' },
    { type: 'text', text: '停止后不应到达' },
  ]);
  const input = page.getByLabel('发给助手的消息');
  await input.fill('继续，等我停止');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByText('这轮尚未报告用量。', { exact: true })).toBeVisible();
  usage = await openUsage(page);
  await expect(usage).toContainText('进行中 · 用量未报告');
  await expect(usage).toContainText('会话累计已报告 48 tokens · 1 轮用量未报告');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  usage = await openUsage(page);
  await expect(usage).toContainText('已停止 · 用量未报告');
  await page.screenshot({ path: testInfo.outputPath('assistant-usage-light.png'), animations: 'disabled' });

  // 独立桌宠页从服务器读取最近对话，实际报告 0 仍是已知值。
  await patchSettings(request, { 'ui.theme': 'deepseek' });
  await page.goto('/companion');
  await page.getByRole('button', { name: '和我说说话', exact: true }).click();
  usage = await openUsage(page);
  await expect(usage).toContainText('会话累计已报告 48 tokens');
  await queueAssistantTurn(request, [
    { type: 'usage', input: 0, output: 0 },
    { type: 'text', text: '实际零用量。' },
  ]);
  await input.fill('零值也如实记录');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByText('实际零用量。', { exact: true })).toBeVisible();
  usage = await openUsage(page);
  await expect(usage).toContainText('已完成 · 输入 0 · 输出 0 tokens');
  await expect(usage).toContainText('会话累计已报告 48 tokens · 1 轮用量未报告');
  await page.reload();
  await page.getByRole('button', { name: '和我说说话', exact: true }).click();
  usage = await openUsage(page);
  await expect(usage).toContainText('已完成 · 输入 0 · 输出 0 tokens');
  await expect(page.getByText('实际零用量。', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('assistant-usage-dark.png'), animations: 'disabled' });
});
