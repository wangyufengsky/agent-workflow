import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  type E2EProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journeys J5 and J6 (07 §5): delivery from the result card, with FakeOpencode playing the AI sessions.

test.slow(GIT_HEAVY_SPECS_SLOW, 'several task runs and merges per test (17 §4.1)');

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
  await expect(page.getByTestId('result-card').getByRole('button', { name: '合并到 main' })).toBeVisible({
    timeout: TASK_RUN_TIMEOUT_MS,
  });
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
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('task-page').getByText('已完成', { exact: true }).first()).toBeVisible();

  expect(git(project.repoPath, 'log', '-1', '--format=%s', 'main')).toMatch(/^问候语写错了 \(T-\d+\)$/);
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe('export const greet = () => "你好";');
  // The worktree and branch are cleaned up after the merge is reported.
  await expect
    .poll(() => git(project.repoPath, 'worktree', 'list', '--porcelain').match(/^worktree /gm))
    .toHaveLength(1);
  await expect.poll(() => git(project.repoPath, 'branch', '--list', 'aw/*')).toBe('');
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
  await expect(page.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });

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
  await expect(result.getByRole('button', { name: '合并到 main' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(result).not.toContainText('时有冲突');
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe(resolved.trimEnd());
});

test('三个任务同时运行改同一文件：各自分支与工作区互不阻塞；依次合并，第二、三个冲突交给 AI 解决（01 §5 第 3 条）', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = () => "hi";\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add greet');
  const workflows = await (await request.get(`${API_BASE}/workflows`, { headers: AUTH })).json();
  const bugfix = workflows.items.find((w: { key: string }) => w.key === 'bugfix');

  // Drafts first, so each task's turns can be queued for its own worktree (named after the task key).
  const words = ['你好', '您好', '早上好'];
  const tasks: Array<{ id: string; key: string }> = [];
  for (const word of words) {
    const res = await request.post(`${API_BASE}/tasks`, {
      headers: AUTH,
      data: { projectId: project.id, workflowId: bugfix.id, requirement: `问候语改成${word}`, start: false },
    });
    const task = await res.json();
    tasks.push(task);
    await queueTurn(request, project, { title: '定位根因', taskKey: task.key }, [submitResult('找到了问候语')]);
    // Each fix waits for a permission, so all three are in flight at once until the user answers.
    await queueTurn(request, project, { title: '修复', taskKey: task.key }, [
      { type: 'permission', permission: 'bash', patterns: [`echo ${word}`] },
      { type: 'edit', file: 'greet.ts', content: `export const greet = () => "${word}";\n` },
      submitResult(`改成了${word}`),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer', taskKey: task.key }, [passReview]);
  }
  for (const task of tasks) await request.post(`${API_BASE}/tasks/${task.id}/start`, { headers: AUTH });

  await page.goto('/inbox');
  const permissions = page.getByTestId('inbox-permission');
  await expect(permissions).toHaveCount(3);
  for (const word of words) {
    await permissions
      .filter({ hasText: `echo ${word}` })
      .getByRole('button', { name: '允许一次' })
      .click();
  }
  const worktrees = git(project.repoPath, 'worktree', 'list', '--porcelain');
  for (const task of tasks) expect(worktrees).toMatch(new RegExp(`^branch refs/heads/aw/${task.key}$`, 'm'));

  let expected = 'hi';
  for (const [i, task] of tasks.entries()) {
    await page.goto(`/tasks/${task.id}`);
    const result = page.getByTestId('result-card');
    await result.getByRole('button', { name: '合并到 main' }).click();
    if (i > 0) {
      await expect(result.getByTestId('delivery-conflict')).toContainText('greet.ts', { timeout: TASK_RUN_TIMEOUT_MS });
      const resolved = `${expected}，${words[i]}`;
      await queueTurn(request, project, { title: '解决合并冲突', taskKey: task.key }, [
        { type: 'edit', file: 'greet.ts', content: `export const greet = () => "${resolved}";\n` },
        submitResult('保留了两边的改动'),
      ]);
      await result.getByRole('button', { name: '交给 AI 解决冲突' }).click();
      await expect(result).not.toContainText('时有冲突');
      await result.getByRole('button', { name: '合并到 main' }).click();
      expected = resolved;
    } else {
      expected = words[0] ?? '';
    }
    await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', {
      timeout: TASK_RUN_TIMEOUT_MS,
    });
    expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe(`export const greet = () => "${expected}";`);
  }
  // The last merge's worktree is removed after the merge is reported.
  await expect
    .poll(() => git(project.repoPath, 'worktree', 'list', '--porcelain').match(/^worktree /gm))
    .toHaveLength(1);
});
