import { API_PREFIX } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

test('项目运行检查失败后跳转设置，修正命令并重新检查', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await page.goto(`/projects/${project.id}`);
  const settings = page.getByRole('region', { name: '项目', exact: true });
  const mode = settings.getByRole('combobox', { name: '任务验收方式' });
  const command = settings.getByRole('textbox', { name: '检查命令' });
  await expect(mode).toHaveValue('auto');
  await expect(command).toHaveAccessibleDescription(/自动验收未能确定适用检查时使用/);
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
  await mode.selectOption('command');
  await expect(command).toHaveAccessibleDescription(/命令用于任务验收/);
  await command.fill(passingCommand);
  try {
    await settings.getByRole('button', { name: '保存修改' }).click();
    await expect(run).toBeDisabled();
  } finally {
    save.resolve();
  }
  await expect(runtime.getByText(passingCommand, { exact: true })).toBeVisible();
  await run.click();
  await expect(runtime.getByText('检查命令：通过')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(mode).toHaveValue('command');
  await expect(command).toHaveValue(passingCommand);
  const revisedCommand = 'node --version';
  // 用户保存验收方式时，助手在同一项目中先更新了备用命令。
  await page.route(`**${API_PREFIX}/projects/${project.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      expect(
        await request.patch(`${API_BASE}/projects/${project.id}`, {
          headers: AUTH,
          data: { checkCommand: revisedCommand },
        }),
      ).toBeOK();
    }
    await route.continue();
  });
  await mode.selectOption('auto');
  await expect(command).toHaveValue(passingCommand);
  await settings.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status').getByText('已保存', { exact: true })).toBeVisible();
  await patchSettings(request, { 'ui.theme': 'default' });
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
    await expect(mode).toHaveValue('auto');
    await expect(command).toHaveValue(revisedCommand);
    await page.getByRole('main').getByRole('link', { name: '项目', exact: true }).click();
    const entry = page.getByRole('link', { name: new RegExp(project.name) });
    await expect(entry).toContainText('任务验收 · 自动验收');
    await expect(entry).toContainText(`回退命令 ${revisedCommand}`);
  } finally {
    await patchSettings(request, { 'ui.theme': 'codex' });
  }
});
