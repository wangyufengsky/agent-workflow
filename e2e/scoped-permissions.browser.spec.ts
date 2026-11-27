import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, pickWorkflow, queueAssistantTurn, queueTurn } from './helpers.ts';

test('对话与直接开始的任务分别保存权限，任务详情可以继续切换', async ({ page, request }) => {
  const project = await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'simple' });
  await page.goto('/?projectId=' + project.id);
  await page.getByRole('button', { name: '对话权限 · 始终询问' }).click();
  const group = page.getByRole('group', { name: '对话权限' });
  await expect(group.getByRole('button')).toHaveCount(3);
  await group.getByRole('button', { name: /帮我批准/ }).click();
  await queueAssistantTurn(request, [{ type: 'text', text: '回到当前项目。' }]);
  await page.getByLabel('告诉助手，或开始任务').fill('查看权限设置');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('回到当前项目。')).toBeVisible();
  const chat = page.url();
  await page.reload();
  await expect(page.getByRole('button', { name: '对话权限 · 帮我批准' })).toBeVisible();
  await page.goto('/?projectId=' + project.id);
  await pickWorkflow(page, '修 Bug');
  await page.getByRole('button', { name: '任务权限 · 始终询问' }).click();
  await page
    .getByRole('group', { name: '任务权限' })
    .getByRole('button', { name: /完全访问/ })
    .click();
  await queueTurn(request, project, { title: '定位根因' }, [{ type: 'hang' }]);
  await page.getByLabel('需求').fill('检查这个项目的任务权限');
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/);
  await page.getByRole('button', { name: '任务权限 · 完全访问' }).click();
  await page
    .getByRole('group', { name: '任务权限' })
    .getByRole('button', { name: /始终询问/ })
    .click();
  await expect(page.getByRole('button', { name: '任务权限 · 始终询问' })).toBeVisible();
  const taskPath = new URL(page.url()).pathname;
  expect((await request.post(API_BASE + taskPath + '/cancel', { headers: AUTH })).ok()).toBe(true);
  await page.goto(chat);
  await expect(page.getByRole('button', { name: '对话权限 · 帮我批准' })).toBeVisible();
});
