import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH, E2E_HOSTING } from './env.ts';
import {
  createProject,
  git,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test('UX-12 选择失败和审查意见，预览并通过任务合并约定', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro', 'node.maxAttempts': 3 });
  const project = await createProject(request, 'git status --porcelain | grep -q .');
  const origin = mkdtempSync(join(tmpdir(), 'aw-convention-origin-'));
  git(origin, 'init', '-q', '--bare');
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = () => "hi";\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add greet');
  git(project.repoPath, 'remote', 'add', 'origin', origin);
  git(project.repoPath, 'push', '-q', 'origin', 'main');
  expect(
    (
      await request.put(`${API_BASE}/projects/${project.id}/hosting`, {
        headers: AUTH,
        data: { provider: 'github', repo: E2E_HOSTING.repo, token: E2E_HOSTING.token },
      })
    ).ok(),
  ).toBeTruthy();
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了原因')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('第一次没有修改')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('第二次没有修改')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'greet.ts', content: 'export const greet = () => "hello";\n' },
    submitResult('完成'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await startTask(page, project, /修 Bug/, '问候语修复');
  const result = page.getByTestId('result-card');
  await result.getByRole('button', { name: '创建 PR' }).click({ timeout: TASK_RUN_TIMEOUT_MS });
  await page.getByRole('dialog', { name: '创建 PR' }).getByRole('button', { name: '推送并创建' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已推送到 PR', { timeout: TASK_RUN_TIMEOUT_MS });
  const taskId = page.url().split('/tasks/')[1] ?? '';
  const task = await (await request.get(`${API_BASE}/tasks/${taskId}`, { headers: AUTH })).json();
  expect(
    (
      await request.post(`${API_BASE}/dev/fake-hosting/comments`, {
        headers: AUTH,
        data: {
          head: task.git.branch,
          author: 'reviewer',
          body: '问候语修改需要覆盖空名称测试',
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/insights');
  await page.getByRole('button', { name: '检查未通过' }).click();
  const row = page.getByTestId('insights-tasks').getByRole('row').filter({ hasText: '问候语修复' });
  await row.getByRole('button', { name: '整理为项目约定' }).click();
  let dialog = page.getByRole('dialog', { name: '整理为项目约定' });
  const failures = dialog.getByRole('checkbox', { name: /检查未通过/ });
  await expect(failures).toHaveCount(2);
  await failures.nth(0).check();
  await dialog.getByRole('button', { name: '这是一次性问题，结束整理' }).click();
  await row.getByRole('button', { name: '整理为项目约定' }).click();
  dialog = page.getByRole('dialog', { name: '整理为项目约定' });
  await expect(dialog.getByRole('checkbox', { name: /检查未通过/ }).nth(0)).not.toBeChecked();
  await dialog
    .getByRole('checkbox', { name: /检查未通过/ })
    .nth(0)
    .check();
  const response = page.waitForResponse(
    (res) => res.url().endsWith('/convention-evidence') && res.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '预览来源与建议' }).click();
  const temporary = await (await response).json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failedDelete = `**/attachments/${temporary.attachmentId}`;
  await page.route(failedDelete, (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'delete failed' } } }),
  );
  await dialog.getByRole('button', { name: '取消并清除' }).click();
  await expect(dialog).toContainText('选中的来源快照');
  await expect(dialog.getByRole('checkbox', { name: /检查未通过/ }).first()).toBeChecked();
  await expect(dialog.getByRole('button', { name: '取消并清除' })).toBeEnabled();
  expect(errors).toEqual([]);
  await page.unroute(failedDelete);
  await dialog.getByRole('button', { name: '取消并清除' }).click();
  expect((await request.get(`${API_BASE}/attachments/${temporary.attachmentId}`, { headers: AUTH })).status()).toBe(
    404,
  );
  await row.getByRole('button', { name: '整理为项目约定' }).click();
  dialog = page.getByRole('dialog', { name: '整理为项目约定' });
  await dialog
    .getByRole('checkbox', { name: /检查未通过/ })
    .nth(0)
    .check();
  await dialog
    .getByRole('checkbox', { name: /检查未通过/ })
    .nth(1)
    .check();
  await dialog.getByRole('button', { name: '继续选择' }).click();
  await page.goto(`/tasks/${taskId}`);
  const review = page.getByTestId('review-comments');
  await review.getByRole('button', { name: '取回审查意见' }).click();
  await review.getByRole('button', { name: '整理为项目约定' }).click();
  dialog = page.getByRole('dialog', { name: '整理为项目约定' });
  await dialog.getByRole('checkbox', { name: /审查意见/ }).check();
  await dialog.getByRole('button', { name: '预览来源与建议' }).click();
  await expect(dialog).toContainText('问候语修改需要覆盖空名称测试');
  await expect(dialog.getByRole('link', { name: /问候语修复/ })).toHaveCount(3);
  await expect(dialog.getByRole('link', { name: '查看对应尝试' }).first()).toHaveAttribute(
    'href',
    new RegExp(`/tasks/${taskId}/nodes/.*[?]attempt=`),
  );
  const firstAttempt = await dialog.getByRole('link', { name: '查看对应尝试' }).nth(0).getAttribute('href');
  const secondAttempt = await dialog.getByRole('link', { name: '查看对应尝试' }).nth(1).getAttribute('href');
  expect(firstAttempt).not.toBe(secondAttempt);
  await expect(dialog.getByRole('link', { name: '查看原审查意见' })).toBeVisible();
  const evidenceHref = await dialog.getByRole('link', { name: '查看对应尝试' }).first().getAttribute('href');
  if (evidenceHref === null) throw new Error('Missing failure evidence link');
  const evidencePage = await page.context().newPage();
  await evidencePage.goto(evidenceHref);
  await expect(evidencePage).toHaveURL(new RegExp(`/tasks/${taskId}/nodes/.*[?]attempt=`));
  await expect(evidencePage.getByText('修复', { exact: true }).first()).toBeVisible();
  await evidencePage.close();
  await dialog.getByLabel('建议的项目约定').fill('问候语修改要覆盖空名称测试。');
  await dialog.getByLabel('适用条件').fill('修改问候语时');
  await page.screenshot({ path: '/private/tmp/ux12-light.png' });
  await patchSettings(request, { 'ui.theme': 'dracula' });
  await page.screenshot({ path: '/private/tmp/ux12-dark.png' });
  await queueTurn(request, project, { title: '梳理项目约定' }, [submitResult('已有检查')]);
  await queueTurn(request, project, { title: '编写 AGENTS.md' }, [
    { type: 'edit', file: 'AGENTS.md', content: '# 项目约定\n\n问候语修改要覆盖空名称测试。\n' },
    submitResult('完成'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  let releaseStart: (() => void) | undefined;
  const holdStart = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let startEntered: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    startEntered = resolve;
  });
  await page.route(`**/projects/${project.id}/agents-md/task`, async (route) => {
    startEntered?.();
    await holdStart;
    await route.continue();
  });
  await dialog.getByRole('button', { name: '确认并发起 AGENTS.md 任务' }).click();
  await entered;
  await expect(dialog.getByRole('button', { name: '继续选择' })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: /检查未通过/ }).first()).toBeDisabled();
  releaseStart?.();
  await expect(page).toHaveURL(/\/tasks\//);
  const conventionResult = page.getByTestId('result-card');
  await conventionResult.getByRole('button', { name: '合并到 main' }).click({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(conventionResult.getByTestId('delivery-outcome')).toContainText('已合并到 main', {
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('region', { name: 'AGENTS.md' })).toContainText('问候语修改要覆盖空名称测试');
});
