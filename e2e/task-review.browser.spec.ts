import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH, E2E_HOSTING } from './env.ts';
import {
  createProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journey J18 (07 §5, 21): review comments of a pull request go back to the AI, and its changes to the same PR.
// FakeOpencode plays the AI sessions, FakeHosting the platform and its reviewers.

test.slow(GIT_HEAVY_SPECS_SLOW, 'two task runs and two pushes (17 §4.1)');

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

async function devPost(request: APIRequestContext, path: string, data: unknown): Promise<void> {
  const res = await request.post(`${API_BASE}/dev/fake-hosting/${path}`, { headers: AUTH, data });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
}

test('J18 PR 审查意见 → 取回并勾选 → AI 按意见修改 → 推送到同一个 PR', async ({ page, request }) => {
  const project = await createProject(request, null);
  const origin = mkdtempSync(join(tmpdir(), 'aw-e2e-origin-'));
  git(origin, 'init', '-q', '--bare');
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = () => "hi";\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add greet');
  git(project.repoPath, 'remote', 'add', 'origin', origin);
  git(project.repoPath, 'push', '-q', 'origin', 'main');
  const bound = await request.put(`${API_BASE}/projects/${project.id}/hosting`, {
    headers: AUTH,
    data: { provider: 'github', repo: E2E_HOSTING.repo, token: E2E_HOSTING.token },
  });
  expect(bound.ok()).toBe(true);

  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了原因')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'greet.ts', content: 'export const greet = () => "你好";\n' },
    submitResult('改成了你好'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await startTask(page, project, /修 Bug/, '问候语写错了');
  const result = page.getByTestId('result-card');
  await result.getByRole('button', { name: '创建 PR' }).click({ timeout: TASK_RUN_TIMEOUT_MS });
  await page.getByRole('dialog', { name: '创建 PR' }).getByRole('button', { name: '推送并创建' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已推送到 PR', { timeout: TASK_RUN_TIMEOUT_MS });

  // Reviewers comment on the pull request from the task's branch.
  const taskId = page.url().split('/tasks/')[1] ?? '';
  const task = await (await request.get(`${API_BASE}/tasks/${taskId}`, { headers: AUTH })).json();
  const head: string = task.git.branch;
  await devPost(request, 'review-threads', {
    head,
    path: 'greet.ts',
    line: 1,
    messages: [{ author: 'alice', body: '名字为空时也要问候' }],
  });
  await devPost(request, 'comments', { head, author: 'bob', body: '再补一个测试' });

  const review = result.getByTestId('review-comments');
  await review.getByRole('button', { name: '取回审查意见' }).click();
  await expect(review.getByRole('checkbox', { name: 'greet.ts 第 1 行' })).toBeChecked();
  await expect(review.getByRole('checkbox', { name: '对话中的评论' })).toBeChecked();
  await expect(review).toContainText('名字为空时也要问候');
  // Only the thread goes to the AI this time.
  await review.getByRole('checkbox', { name: '对话中的评论' }).uncheck();
  await expect(review).toContainText('已选 1 条');

  const revised = 'export const greet = (name = "") => (name === "" ? "你好" : "你好，" + name);\n';
  await queueTurn(request, project, { title: '按审查意见修改' }, [
    { type: 'edit', file: 'greet.ts', content: revised },
    submitResult('名字为空时也问候'),
  ]);
  await review.getByLabel('补充说明（可选）').fill('保持导出名不变');
  await review.getByRole('button', { name: '让 AI 按意见再改改' }).click();

  const push = result.getByRole('button', { name: '推送到 PR' });
  await expect(push).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(result.getByRole('button', { name: '创建 PR' })).toHaveCount(0);
  await push.click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已推送到 PR', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('task-page').getByText('已完成', { exact: true }).first()).toBeVisible();

  // The same branch on the platform has the AI's change; merging stays on the platform (D16).
  expect(`${git(origin, 'show', `refs/heads/${head}:greet.ts`)}\n`).toBe(revised);
  expect(git(origin, 'show', 'main:greet.ts')).toBe('export const greet = () => "hi";');
});
