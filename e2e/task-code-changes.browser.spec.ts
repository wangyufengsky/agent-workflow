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
    await request.post(API_BASE + taskPath + '/cancel', { headers: AUTH, data: {} });
  }
});

test('选择跟随阅读后看到项目文件的实际摘录，暂停保留位置，继续后返回代码成果', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    {
      type: 'tool',
      tool: 'read',
      input: { filePath: 'package.json', offset: 1 },
      output: '<content>1: {"scripts":{"test":"vitest run"}}</content>',
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
    await expect(reading.getByText('第 1 行')).toBeVisible();
    await page.screenshot({ path: info.outputPath('reading.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '暂停跟随阅读' }).click();
    await page.getByRole('tab', { name: '流程画布' }).click();
    await page.getByRole('button', { name: '允许一次' }).click();
    await page.getByRole('tab', { name: '代码改动' }).click();
    await expect(reading).toContainText('package.json');
    await page.getByRole('button', { name: '继续跟随阅读' }).click();
    await expect(reading).toHaveCount(0);
    await expect(page.getByTestId('task-code-changes')).toContainText('probe.js');
  } finally {
    await request.post(`${API_BASE}${taskPath}/cancel`, { headers: AUTH, data: {} });
  }
});
