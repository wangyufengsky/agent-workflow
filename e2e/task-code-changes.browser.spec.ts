import { InboxKind, taskDetailSchema } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, queueTurn, startTask, submitResult, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

test('修复中的任务展示未提交文件，切到画布可单击查看步骤详情', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('输入为空时列表没有提示。')]);
  await queueTurn(request, project, { title: '修复' }, [
    {
      type: 'edit',
      file: 'empty-state.ts',
      content:
        'export function emptyMessage(count: number) {\n  if (count === 0) return "暂无任务";\n  return "";\n}\n',
    },
    { type: 'permission', permission: 'bash', patterns: ['node verify-empty-state.mjs'] },
    { type: 'edit', file: 'task-count.ts', content: 'export const taskCount = (tasks: unknown[]) => tasks.length;\n' },
    { type: 'hang' },
  ]);
  await startTask(page, project, /^修 Bug$/, '为空任务列表添加提示');
  const taskPath = new URL(page.url()).pathname;
  try {
    const result = page.getByTestId('task-code-changes');
    await expect(result.getByTestId('diff-view')).toContainText('暂无任务', { timeout: TASK_RUN_TIMEOUT_MS });
    await expect(result.locator('[data-focus=true]').first()).toBeVisible();
    await page.getByRole('button', { name: '扩大视图' }).click();
    await expect(page.getByRole('button', { name: '还原视图' })).toBeVisible();
    const files = result.getByRole('navigation', { name: '改动文件' });
    const bounds = await files.boundingBox();
    const codeBounds = await result.getByTestId('diff-view').boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(216);
    expect(bounds?.x).toBeGreaterThan(codeBounds?.x ?? Number.POSITIVE_INFINITY);
    await result.getByRole('button', { name: 'AI 活动' }).click();
    await expect(result.getByTestId('conversation-stream')).toContainText('修复');
    await expect(files).toBeHidden();
    await result.getByRole('button', { name: '改动文件' }).click();
    await expect(files).toBeVisible();
    await page.screenshot({ path: info.outputPath('code.png'), animations: 'disabled' });
    await result.getByRole('button', { name: '跟随编辑', exact: true }).click();
    await page.getByRole('button', { name: '允许一次' }).click();
    await expect(result.getByRole('button', { name: /task-count.ts/ })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
    await expect(result.getByTestId('diff-view')).toContainText('emptyMessage');
    await result.getByRole('button', { name: '继续跟随编辑' }).click();
    await expect(result.getByTestId('diff-view')).toContainText('taskCount');
    await page.getByRole('tab', { name: '流程画布' }).click();
    await page.getByTestId('step-fix').click();
    await expect(page.getByRole('dialog').getByRole('tab', { name: '过程' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('node-details.png'), animations: 'disabled' });
    await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
    await page.getByRole('tab', { name: '代码改动' }).click();
    await expect(result).toBeVisible();
  } finally {
    await request.post(`${API_BASE}${taskPath}/cancel`, { headers: AUTH, data: {} });
  }
});

test('选择跟随阅读后看到项目文件的实际摘录，暂停保留位置，继续后返回代码成果', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    {
      type: 'tool',
      tool: 'read',
      input: { filePath: 'package.json', offset: 201 },
      output:
        '<content>201: vitest run\n' +
        Array.from({ length: 100 }, (_, i) => `${202 + i}: config`).join('\n') +
        '</content>',
    },
    { type: 'permission', permission: 'bash', patterns: ['node verify-reading.mjs'] },
    { type: 'edit', file: 'probe.js', content: 'export const probe = true;\n' },
    { type: 'tool', tool: 'read', input: { filePath: 'probe.js' }, output: 'export const probe = true;' },
    { type: 'hang' },
  ]);
  await startTask(page, project, /^修 Bug$/, '查看项目已有的测试命令');
  const taskPath = new URL(page.url()).pathname;
  try {
    await page.getByRole('button', { name: '跟随 AI 阅读', exact: true }).click();
    const reading = page.getByRole('region', { name: '项目文件阅读' });
    await expect(reading).toContainText('package.json');
    await expect(reading).toContainText('vitest run');
    await expect(reading.getByText('第 201 行')).toBeVisible();
    await expect(reading.locator('mark')).toContainText('201: vitest run');
    await page.screenshot({ path: info.outputPath('reading.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '暂停跟随阅读' }).click();
    const scroll = await reading.locator('pre').evaluate((el) => {
      el.scrollTop = 200;
      return el.scrollTop;
    });
    expect(scroll).toBeGreaterThan(0);
    await page.getByRole('tab', { name: '流程画布' }).click();
    await page.getByRole('button', { name: '允许一次' }).click();
    await page.getByRole('tab', { name: '代码改动' }).click();
    await expect(reading).toContainText('package.json');
    expect(await reading.locator('pre').evaluate((el) => el.scrollTop)).toBe(scroll);
    await page.getByRole('button', { name: '继续跟随阅读' }).click();
    await expect(reading).toHaveCount(0);
    await expect(page.getByTestId('task-code-changes')).toContainText('probe.js');
  } finally {
    await request.post(`${API_BASE}${taskPath}/cancel`, { headers: AUTH, data: {} });
  }
});

test('跟随同一文件深处的修改时只滚动代码框，任务页留在原位', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  const lines = Array.from({ length: 140 }, (_, i) => `export const row${i} = ${i};`);
  const modified = lines.map((line, i) => (i === 139 ? 'export const row139 = 999;' : line));
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('已定位。')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'long.ts', content: lines.join('\n') },
    { type: 'permission', permission: 'bash', patterns: ['node verify-long.mjs'] },
    { type: 'edit', file: 'long.ts', content: modified.join('\n') },
    { type: 'hang' },
  ]);
  await startTask(page, project, /^修 Bug$/, '核对长文件修改');
  const path = new URL(page.url()).pathname;
  try {
    const frame = page.getByTestId('diff-view');
    const tabs = page.getByRole('tablist', { name: '任务视图' });
    await expect(frame.locator('[data-focus]')).toContainText('row0', { timeout: TASK_RUN_TIMEOUT_MS });
    const top = await tabs.evaluate((el) => el.getBoundingClientRect().top);
    const detail = taskDetailSchema.parse(await (await request.get(API_BASE + path, { headers: AUTH })).json());
    const item = detail.openInbox.find((i) => i.kind === InboxKind.Permission);
    if (!item) throw new Error('Missing pending permission');
    await expect(
      await request.post(`${API_BASE}/inbox/${item.id}/resolve`, {
        headers: AUTH,
        data: { response: { decision: 'once' } },
      }),
    ).toBeOK();
    const focus = frame.locator('[data-focus]');
    await expect(focus).toContainText('row139 = 999', { timeout: TASK_RUN_TIMEOUT_MS });
    await expect(focus).toBeInViewport();
    expect(await frame.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await tabs.evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(top, 0);
    await page.screenshot({ path: info.outputPath('follow-last-line.png'), animations: 'disabled' });
  } finally {
    await request.post(API_BASE + path + '/cancel', { headers: AUTH, data: {} });
  }
});
