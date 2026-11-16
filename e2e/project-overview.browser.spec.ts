import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings, queueTurn } from './helpers.ts';

test('项目概览：快捷入口、项目任务和状态更新', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  const other = await createProject(request, null);
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const workflow = workflows.items.find((item: { key: string }) => item.key === 'feature');
  const create = async (projectId: string, requirement: string) => {
    const response = await request.post(`${API_BASE}/tasks`, {
      headers: AUTH,
      data: { projectId, workflowId: workflow.id, requirement, start: false },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const task = await create(project.id, '项目专属近期任务');
  await create(other.id, '其他项目的任务');
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/projects/${project.id}`);
  const recent = page.getByRole('region', { name: '近期任务' });
  await expect(recent).toContainText('项目专属近期任务');
  await expect(recent).not.toContainText('其他项目的任务');
  await request.post(`${API_BASE}/tasks/${task.id}/cancel`, { headers: AUTH, data: {} });
  await expect(recent).toContainText('已取消');
  await recent.getByRole('link', { name: '查看本项目全部任务' }).click();
  await expect(page.getByRole('combobox', { name: '全部项目' })).toHaveValue(project.id);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('main').getByRole('link', { name: '开始任务', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`projectId=${project.id}`));
  await expect(page).toHaveURL(/workflow=feature/);
  await expect(page.getByRole('combobox', { name: '项目', exact: true })).toHaveValue(project.id);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('link', { name: '问这个项目' }).click();
  await expect(page).toHaveURL(new RegExp(`assistantProjectId=${project.id}`));
  await expect(page.getByRole('combobox', { name: '会话项目' })).toHaveValue(project.id);
  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('main').getByRole('link', { name: '开始任务', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '问这个项目' })).toBeVisible();
  await expect(page.getByRole('region', { name: '项目' }).getByLabel('检查命令')).toBeVisible();
  await expect(page.getByRole('region', { name: '页面预览' })).toBeVisible();
  await patchSettings(request, { 'ui.mode': 'simple' });
});

test('项目概览优先显示较早的待处理任务', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple', 'ai.askOnUncertainty': true });
  const project = await createProject(request, null);
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const workflow = workflows.items.find((item: { key: string }) => item.key === 'bugfix');
  await queueTurn(request, project, { title: '定位根因' }, [
    {
      type: 'callTool',
      name: 'ask_user',
      args: { question: '请确认环境', blocking: true },
    },
  ]);
  const response = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: { projectId: project.id, workflowId: workflow.id, requirement: '较早的待处理任务' },
  });
  expect(response.ok()).toBeTruthy();
  const task = await response.json();
  await expect
    .poll(async () => {
      const detail = await (await request.get(`${API_BASE}/tasks/${task.id}`, { headers: AUTH })).json();
      return detail.displayGroup;
    })
    .toBe('needs_attention');
  for (let index = 0; index < 6; index++) {
    const draft = await request.post(`${API_BASE}/tasks`, {
      headers: AUTH,
      data: { projectId: project.id, workflowId: workflow.id, requirement: `较新的任务 ${index}`, start: false },
    });
    expect(draft.ok()).toBeTruthy();
  }
  await page.goto(`/projects/${project.id}`);
  const rows = page.getByRole('region', { name: '近期任务' }).getByTestId('task-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('较早的待处理任务');
  await patchSettings(request, { 'ai.askOnUncertainty': false });
});
