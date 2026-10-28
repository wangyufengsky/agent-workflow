import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_HOSTING } from './env.ts';
import { createProject, git, patchSettings } from './helpers.ts';

// The project page's forms confirm what they saved (14 §3.7). Each form is keyed by the project's update time, so a
// save remounts it: the confirmation must not depend on the form still being mounted.

test('项目基本信息与远端仓库：保存、绑定、解除绑定后都有提示', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
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

test('仓库检出的分支与默认分支不同：项目页说明并可一键改用（D216）', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  git(project.repoPath, 'checkout', '-q', '-b', 'dev');
  await page.goto(`/projects/${project.id}`);

  const basics = page.getByRole('region', { name: '项目' });
  await expect(basics.getByTestId('other-branch')).toContainText('仓库现在检出的是 dev，新任务却从 main 开始');
  await basics.getByRole('button', { name: '改用 dev' }).click();
  await expect(page.getByRole('status').getByText('已保存', { exact: true })).toBeVisible();
  await expect(basics.getByLabel('默认分支')).toHaveValue('dev');
  await expect(basics.getByTestId('other-branch')).toHaveCount(0);
});

test('添加没有 Git 的目录：确认初始化 Git 后照常添加项目（D153）', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  // Without any project every page leads to onboarding; this goes through the projects page's dialog.
  await createProject(request, null);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aw-e2e-plain-')));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'left-pad.js'), 'pad');

  await page.goto('/projects');
  await page.getByRole('button', { name: '添加项目' }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目' });
  await dialog.getByLabel('仓库目录').fill(dir);
  await dialog.getByRole('button', { name: '添加项目' }).click();

  const confirm = dialog.getByRole('region', { name: '这个目录还没有用 Git 管理' });
  await expect(confirm.getByRole('listitem')).toHaveText([
    '在目录里运行 git init -b main',
    '写入 .gitignore，忽略 node_modules/、.DS_Store',
    /^把现有的 2 个文件（共 \d+ B）作为第一个提交$/,
  ]);
  await confirm.getByRole('button', { name: '初始化 Git 并添加' }).click();

  await expect(page.getByRole('status').getByText('项目已添加')).toBeVisible();
  await expect(page.getByRole('heading', { name: dir.split(/[\\/]/).pop(), level: 1 })).toBeVisible();
  expect(git(dir, 'log', '--format=%s')).toBe('Initial commit');
  expect(git(dir, 'ls-files')).toBe('.gitignore\npackage.json');
});
