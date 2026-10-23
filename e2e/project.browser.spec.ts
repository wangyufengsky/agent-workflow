import { expect, test } from '@playwright/test';
import { E2E_HOSTING } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

// The project page's forms confirm what they saved (14 §3.7). Each form is keyed by the project's update time, so a
// save remounts it: the confirmation must not depend on the form still being mounted.

test('项目基本信息与远端仓库：保存、绑定、解除绑定后都有提示', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await page.goto(`/projects/${project.id}`);

  const basics = page.getByRole('region', { name: '项目' });
  await basics.getByLabel('名称').fill('订单服务');
  await basics.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status').getByText('已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单服务', level: 1 })).toBeVisible();

  const remote = page.getByRole('form', { name: '远端仓库' });
  await remote.getByLabel('仓库').fill(E2E_HOSTING.repo);
  await remote.getByLabel('访问令牌').fill(E2E_HOSTING.token);
  await remote.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.getByRole('status').getByText('远端已绑定')).toBeVisible();

  await page.getByRole('button', { name: '解除绑定' }).click();
  await expect(page.getByRole('status').getByText('已解除绑定')).toBeVisible();
});
