import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject } from './helpers.ts';

test('用户预览在普通浏览器中提示桌面版，不建立假的用户页签', async ({ page, request }) => {
  const project = await createProject(request, null);
  await request.patch(`${API_BASE}/projects/${project.id}`, {
    headers: AUTH,
    data: {
      preview: { command: 'node server.mjs', setupCommand: null, readyPath: '/', pages: ['/'], extraOrigins: [] },
    },
  });
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const workflow = workflows.items.find((item: { key: string }) => item.key === 'bugfix');
  const task = await (
    await request.post(`${API_BASE}/tasks`, {
      headers: AUTH,
      data: { projectId: project.id, workflowId: workflow.id, requirement: '浏览器预览提示', start: false },
    })
  ).json();
  await page.goto(`/tasks/${task.id}?preview=true`);
  await expect(page.getByText('我的预览只在桌面版中显示。助手读取当前预览也需要桌面版。')).toBeVisible();
  await expect(page.getByRole('button', { name: '打开我的预览' })).toHaveCount(0);
  await expect(page.getByTestId('user-preview-area')).toHaveCount(0);
});
