import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  git,
  passReview,
  patchSettings,
  queueCodeReviewerTurn,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'pro' }));
test.afterEach(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

for (const target of ['worktree', 'commit', 'branch', 'range'] as const) {
  test(`J24 ${target} 审查入口：进度、思考、正文、工具详情，刷新与完成后保留过程`, async ({ page, request }) => {
    const project = await createProject(request, null);
    git(project.repoPath, 'config', 'user.name', 'Zhang Wei');
    git(project.repoPath, 'config', 'user.email', 'zhang@example.com');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (target === 'worktree') await page.setViewportSize({ width: 1440, height: 900 });
    git(project.repoPath, 'checkout', '-qb', 'feature/review');
    writeFileSync(join(project.repoPath, 'review.ts'), 'export const total = 1;\n');
    git(project.repoPath, 'add', 'review.ts');
    git(project.repoPath, 'commit', '-qm', 'Review totals');
    const sha = git(project.repoPath, 'rev-parse', 'HEAD');
    git(project.repoPath, 'checkout', '-q', 'main');
    writeFileSync(join(project.repoPath, 'notes.md'), 'review notes\n');
    await queueCodeReviewerTurn(request, project, [
      { type: 'callTool', name: 'report_progress', args: { message: '正在核对金额计算与边界条件' } },
      { type: 'think', text: '先检查金额计算。\n然后核对边界条件是否有测试覆盖。' },
      { type: 'text', text: '已定位到需要核对的代码。' },
      { type: 'tool', tool: 'read', input: { filePath: 'review.ts' }, output: 'export const total = 1;' },
      { type: 'permission', permission: 'bash', patterns: ['find . -name review.ts -exec cat {} \\;'] },
      { type: 'callTool', name: 'submit_findings', args: { summary: '检查完成，没有发现问题。', findings: [] } },
    ]);
    if (target === 'worktree' || target === 'commit') {
      await page.goto(
        `/git/${project.id}?${target === 'worktree' ? 'view=changes&tab=review' : `view=commits&sha=${sha}&tab=review`}`,
      );
      await page.getByRole('button', { name: '开始审查', exact: true }).click();
    } else {
      await page.goto(`/git/${project.id}?view=branches`);
      if (target === 'branch') {
        await page
          .getByTestId('git-branch')
          .filter({ hasText: 'feature/review' })
          .getByRole('button', { name: '更多 · feature/review' })
          .click();
        await page.getByRole('menuitem', { name: 'AI 审查', exact: true }).click();
      } else {
        await page.getByLabel('从', { exact: true }).fill('main');
        await page.getByLabel('到', { exact: true }).fill('feature/review');
        await page.getByRole('button', { name: '比较', exact: true }).click();
        await page.getByRole('button', { name: '审查这段差异' }).click();
      }
    }
    const review = page.getByTestId('git-review');
    const stream = review.getByTestId('conversation-stream');
    await expect(stream).toContainText('正在核对金额计算与边界条件', { timeout: TASK_RUN_TIMEOUT_MS });
    await expect(stream).toContainText('已定位到需要核对的代码。');
    await stream.getByTestId('stream-thinking').getByRole('button').click();
    await expect(stream.getByTestId('stream-thinking')).toContainText('然后核对边界条件是否有测试覆盖。');
    await stream.getByTestId('stream-action').filter({ hasText: 'review.ts' }).getByRole('button').click();
    await expect(stream).toContainText('export const total = 1;');
    if (target === 'worktree') {
      await page.screenshot({ path: 'screenshots/review-progress-light.png', fullPage: true, animations: 'disabled' });
      await patchSettings(request, { 'ui.theme': 'default' });
      await page.reload();
      await expect(stream.getByTestId('stream-thinking')).toBeVisible();
      await stream.getByTestId('stream-thinking').getByRole('button').click();
      await stream.getByTestId('stream-action').filter({ hasText: 'review.ts' }).getByRole('button').click();
      await page.screenshot({ path: 'screenshots/review-progress-dark.png', fullPage: true, animations: 'disabled' });
    }
    await page.reload();
    await expect(stream).toContainText('已定位到需要核对的代码。');
    if (target === 'worktree') {
      await stream.getByRole('link', { name: '去处理' }).click();
      await expect(page.getByTestId('inbox-permission')).toContainText('Git 审查');
      await page.goBack();
      await expect(stream).toContainText('已定位到需要核对的代码。');
    }
    const height = await stream.getByTestId('stream-scroll').evaluate((el) => el.clientHeight);
    expect(height).toBeGreaterThan(250);
    expect(height).toBeLessThanOrEqual(640);
    const items = await (await request.get(`${API_BASE}/inbox?status=open`, { headers: AUTH })).json();
    const permission = items.items.find(
      (i: { kind: string; payload: { directory?: string } }) =>
        i.kind === 'permission' && i.payload.directory === project.repoPath,
    );
    const resolved = await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
      headers: AUTH,
      data: { response: { decision: 'once' } },
    });
    expect(resolved.ok()).toBe(true);
    await expect(review.getByTestId('git-review-verdict')).toContainText('检查完成，没有发现问题。');
    const toggle = stream.getByRole('button', { name: /评审过程/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(stream).toContainText('已定位到需要核对的代码。');
    if (target === 'worktree') {
      await queueCodeReviewerTurn(request, project, [
        { type: 'text', text: '第二次审查的独立过程。' },
        { type: 'hang' },
      ]);
      await review.getByRole('button', { name: '重新审查' }).click();
      await expect(stream).toContainText('第二次审查的独立过程。');
      const history = review.getByRole('combobox', { name: 'AI 审查' });
      await history.selectOption({ index: 1 });
      await expect(stream).toContainText('已定位到需要核对的代码。');
      await expect(stream).not.toContainText('第二次审查的独立过程。');
      await history.selectOption({ index: 0 });
      await expect(stream).toContainText('第二次审查的独立过程。');
      await review.getByRole('button', { name: '停止', exact: true }).click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(stream).toContainText('第二次审查的独立过程。');
    }
    // Git 总览会读取每个项目的状态与提交；用例结束后移除测试项目，避免给后续走查累加仓库。
    expect((await request.delete(`${API_BASE}/projects/${project.id}`, { headers: AUTH })).status()).toBe(204);
  });
}

test('J22 任务 AI 评审：当前步骤与简单过程页显示评审会话，完成后保留', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('已定位')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('已修复')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [
    { type: 'callTool', name: 'report_progress', args: { message: '评审修复的边界条件' } },
    { type: 'think', text: '确认修复不会改变已有行为，再检查边界条件。' },
    { type: 'text', text: '正在核对修复结果。' },
    { type: 'permission', permission: 'bash', patterns: ['pnpm test'] },
    passReview,
  ]);
  await startTask(page, project, /修 Bug/, '修复并评审边界条件');
  const side = page.getByTestId('current-step');
  await expect(side.getByTestId('conversation-stream')).toContainText('评审修复的边界条件', {
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  const taskId = new URL(page.url()).pathname.split('/')[2];
  const task = await (await request.get(`${API_BASE}/tasks/${taskId}`, { headers: AUTH })).json();
  const nodeId: string = task.nodes.find((n: { key: string }) => n.key === 'fix').id;
  await page.goto(`/tasks/${taskId}/nodes/${nodeId}`);
  const review = page
    .getByTestId('conversation-stream')
    .filter({ has: page.getByRole('button', { name: /评审过程/ }) });
  await expect(review).toContainText('正在核对修复结果。');
  await expect(review.getByTestId('stream-thinking')).toContainText('确认修复不会改变已有行为');
  const permission = task.openInbox.find((i: { kind: string }) => i.kind === 'permission');
  expect(
    (
      await request.post(`${API_BASE}/inbox/${permission.id}/resolve`, {
        headers: AUTH,
        data: { response: { decision: 'once' } },
      })
    ).ok(),
  ).toBe(true);
  await expect(review.getByRole('button', { name: /评审过程/ })).toHaveAttribute('aria-expanded', 'false');
  await review.getByRole('button', { name: /评审过程/ }).click();
  await expect(review).toContainText('正在核对修复结果。');
});
