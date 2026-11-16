import { API_PREFIX } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

test('项目运行检查失败后跳转设置，修正命令并重新检查', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await page.goto(`/projects/${project.id}`);
  const settings = page.getByRole('region', { name: '项目', exact: true });
  await settings.getByLabel('检查命令').fill('node -e "process.exit(1)"');
  await settings.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status').getByText('已保存', { exact: true })).toBeVisible();
  const runtime = page.getByRole('region', { name: '检查运行环境' });
  await runtime.getByRole('button', { name: '运行检查' }).click();
  await expect(runtime.getByText('检查命令：失败')).toBeVisible({ timeout: 15000 });
  await runtime.getByRole('link', { name: '前往设置' }).click();
  await expect(page).toHaveURL(/#project-check$/);
  const passingCommand = 'node -e "process.exit(0)"';
  const save = Promise.withResolvers<void>();
  await page.route(`**${API_PREFIX}/projects/${project.id}`, async (route) => {
    if (route.request().method() === 'PATCH') await save.promise;
    await route.continue();
  });
  const run = runtime.getByRole('button', { name: '运行检查' });
  await settings.getByLabel('检查命令').fill(passingCommand);
  try {
    await settings.getByRole('button', { name: '保存修改' }).click();
    await expect(run).toBeDisabled();
  } finally {
    save.resolve();
  }
  await expect(runtime.getByText(passingCommand, { exact: true })).toBeVisible();
  await run.click();
  await expect(runtime.getByText('检查命令：通过')).toBeVisible({ timeout: 15000 });
});
