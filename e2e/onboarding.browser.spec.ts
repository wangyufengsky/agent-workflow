import { expect, test } from '@playwright/test';
import { createRepo, patchSettings } from './helpers.ts';

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

test('首次启动：环境检测通过 → 添加项目 → 切换主题与模式无需刷新', async ({ page }) => {
  const repo = createRepo();

  // No project yet: every page leads to onboarding.
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('check-Git')).toContainText('已就绪');
  await expect(page.getByTestId('check-opencode 1.19.0')).toContainText('已就绪');

  await page.getByLabel('仓库目录').fill(repo);
  await page.getByRole('button', { name: '添加项目' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();

  // With a project, the sidebar's runtime chip opens the checks inside the shell, not the first-run page.
  await page.getByTestId('runtime-chip').click();
  await expect(page).toHaveURL(/\/environment$/);
  await expect(page.getByTestId('check-Git')).toContainText('已就绪');
  await expect(page.getByRole('navigation').getByRole('link', { name: '项目' })).toBeVisible();
  await expect(page.getByLabel('仓库目录')).toHaveCount(0);
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/environment$/);

  // The project with inferred check command is listed.
  await page.getByRole('navigation').getByRole('link', { name: '项目' }).click();
  await expect(page.getByText('pnpm test').or(page.getByText('npm test'))).toBeVisible();

  // A reload would drop this marker: theme and mode must apply in place.
  await page.evaluate(() => {
    Object.assign(window, { __noReload: true });
  });
  await page.getByRole('navigation').getByRole('link', { name: '设置' }).click();
  const html = page.locator('html');
  for (const [label, id, bg] of [
    ['默认', 'default', '#0a0a0a'],
    ['Claude Code', 'claude_code', '#f8f7f3'],
    ['Codex', 'codex', '#ffffff'],
    ['DeepSeek', 'deepseek', '#ffffff'],
    ['Dracula', 'dracula', '#282a36'],
  ] as const) {
    await page.getByRole('group', { name: '主题' }).getByRole('button', { name: label }).click();
    await expect(html).toHaveAttribute('data-theme', id);
    expect(await html.evaluate((el) => el.style.getPropertyValue('--bg'))).toBe(bg);
  }

  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: '流程' })).toHaveCount(0);
  await page.getByRole('switch', { name: '专业模式' }).click();
  await expect(nav.getByRole('link', { name: '流程' })).toBeVisible();
  await page.getByRole('switch', { name: '专业模式' }).click();
  await expect(nav.getByRole('link', { name: '流程' })).toHaveCount(0);

  expect(await page.evaluate(() => '__noReload' in window)).toBe(true);
});
