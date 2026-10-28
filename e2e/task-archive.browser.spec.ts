import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, type E2EProject, patchSettings } from './helpers.ts';

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

/** A draft task of `project`, cancelled through the API: a finished task that never ran. */
async function cancelledTask(request: APIRequestContext, project: E2EProject, requirement: string) {
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const bugfix = workflows.items.find((w: { key: string }) => w.key === 'bugfix');
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId: project.id, workflowId: bugfix.id, requirement, start: false },
  });
  if (!created.ok()) throw new Error(`POST /tasks failed: ${created.status()} ${await created.text()}`);
  const task: { id: string; title: string } = await created.json();
  const cancelled = await request.post(`${API_BASE}/tasks/${task.id}/cancel`, { headers: AUTH, data: {} });
  if (!cancelled.ok()) throw new Error(`POST /tasks/:id/cancel failed: ${cancelled.status()}`);
  return task;
}

test('J45 任务归档与删除（42）：任务页归档 → 列表「已归档」里找到 → 取消归档 → 删除后回到列表且看不到它', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  const task = await cancelledTask(request, project, '归档与删除的演示任务');
  const row = (scope: 'all' | 'archived') =>
    page.goto(`/tasks?projectId=${project.id}${scope === 'archived' ? '&archived=true' : ''}`);

  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await expect(page.getByText('任务已归档')).toBeVisible();
  await expect(page.getByTestId('task-page').getByText('已归档', { exact: true }).first()).toBeVisible();

  await row('all');
  await expect(page.getByRole('link', { name: new RegExp(task.title) })).toHaveCount(0);
  await page.getByRole('combobox', { name: '全部状态' }).selectOption({ label: '已归档' });
  await page.getByRole('link', { name: new RegExp(task.title) }).click();
  await page.getByRole('button', { name: '取消归档' }).click();
  await expect(page.getByText('已取消归档')).toBeVisible();

  await page.getByRole('button', { name: '删除任务' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('分支、提交和 PR 不受影响');
  await dialog.getByRole('button', { name: '删除任务' }).click();
  await expect(page).toHaveURL(/\/tasks(\?|$)/);
  await expect(page.getByText('任务已删除')).toBeVisible();
  await row('all');
  await expect(page.getByText('还没有任务')).toBeVisible();
  await row('archived');
  await expect(page.getByText('没有已归档的任务')).toBeVisible();
});
