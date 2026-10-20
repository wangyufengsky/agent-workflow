import { expect, test } from '@playwright/test';
import { createProject, patchSettings } from './helpers.ts';

// M4-08 smoke: the Git console's tabs open and show the repository.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro' }));
test.afterEach(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

test('Git 管理台：分支、提交与 diff、文件、worktree', async ({ page, request }) => {
  const project = await createProject(request, null);
  await page.goto('/git');
  await page.getByRole('link', { name: new RegExp(project.name) }).click();
  await expect(page.getByTestId('git-status')).toContainText('main');

  await expect(page.getByTestId('git-branch').filter({ hasText: 'main' })).toContainText('当前');
  await page.getByRole('tab', { name: '提交' }).click();
  await page.getByTestId('git-log-entry').filter({ hasText: 'init' }).getByRole('button').click();
  await expect(page.getByTestId('git-commit').getByTestId('diff-view')).toContainText('vitest run');

  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByRole('button', { name: 'package.json' }).click();
  await expect(page.getByTestId('git-file')).toContainText('"test"');

  await page.getByRole('tab', { name: 'Worktree' }).click();
  await expect(page.getByTestId('git-worktree')).toContainText('主工作区');
});
