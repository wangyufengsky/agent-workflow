import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  createProject,
  type E2EProject,
  git,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
} from './helpers.ts';

// Journeys J5 and J6 (07 §5): delivery from the result card, with FakeOpencode playing the AI sessions.

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple', 'delivery.defaultStrategy': 'squash' }),
);

/** A bug-fix task whose fix step writes `content` into greet.ts, run until its result card waits for a decision. */
async function fixInReview(
  page: Page,
  request: Parameters<typeof queueTurn>[0],
  project: E2EProject,
  requirement: string,
  content: string,
): Promise<string> {
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了原因')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'greet.ts', content },
    submitResult(`已修复：${requirement}`),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await startTask(page, project, /修 Bug/, requirement);
  await expect(page.getByTestId('result-card').getByRole('button', { name: '合并到 main' })).toBeVisible();
  return page.url();
}

test('J5 合并到 main（squash）→ 主分支有提交、worktree 已清理、任务已完成', async ({ page, request }) => {
  const project = await createProject(request, null);
  await fixInReview(page, request, project, '问候语写错了', 'export const greet = () => "你好";\n');
  const result = page.getByTestId('result-card');

  // The changes can be read line by line before merging.
  await result.getByRole('button', { name: '查看改动' }).click();
  const changes = page.getByRole('dialog', { name: '改动' });
  await expect(changes.getByTestId('diff-view')).toContainText('export const greet = () => "你好";');
  await changes.getByRole('button', { name: '并排视图' }).click();
  await expect(changes.getByTestId('diff-view')).toBeVisible();
  await page.keyboard.press('Escape');

  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main');
  await expect(page.getByTestId('task-page').getByText('已完成', { exact: true }).first()).toBeVisible();

  expect(git(project.repoPath, 'log', '-1', '--format=%s', 'main')).toMatch(/^问候语写错了 \(T-\d+\)$/);
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe('export const greet = () => "你好";');
  expect(git(project.repoPath, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  expect(git(project.repoPath, 'branch', '--list', 'aw/*')).toBe('');
});

test('J6 两个任务改同一文件 → 第二个合并冲突 → 交给 AI 解决 → 合并成功', async ({ page, request }) => {
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = () => "hi";\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add greet');

  const first = await fixInReview(page, request, project, '改成你好', 'export const greet = () => "你好";\n');
  const second = await fixInReview(page, request, project, '改成您好', 'export const greet = () => "您好";\n');

  await page.goto(first);
  await page.getByTestId('result-card').getByRole('button', { name: '合并到 main' }).click();
  await expect(page.getByTestId('delivery-outcome')).toContainText('已合并到 main');

  await page.goto(second);
  const result = page.getByTestId('result-card');
  await result.getByRole('button', { name: '合并到 main' }).click();
  const conflict = result.getByTestId('delivery-conflict');
  await expect(conflict).toContainText('合并到 main 时有冲突');
  await expect(conflict).toContainText('greet.ts');
  // main is untouched by the aborted merge.
  expect(git(project.repoPath, 'status', '--porcelain')).toBe('');

  const resolved = 'export const greet = () => "你好，您好";\n';
  await queueTurn(request, project, { title: '解决合并冲突' }, [
    { type: 'edit', file: 'greet.ts', content: resolved },
    submitResult('保留了两边的改动'),
  ]);
  await result.getByRole('button', { name: '交给 AI 解决冲突' }).click();
  await expect(result.getByRole('button', { name: '合并到 main' })).toBeVisible();
  await expect(result).not.toContainText('时有冲突');
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main');
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe(resolved.trimEnd());
});
