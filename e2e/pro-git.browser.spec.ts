import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_PREFIX } from '@aw/shared';
import { expect, type Page, test } from '@playwright/test';
import {
  createProject,
  type E2EProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  patchSettings,
  queueCodeReviewerTurn,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journey J24 (07 §5, 27): the user's own Git work in the Git workbench, with FakeOpencode playing the AI.

test.slow(GIT_HEAVY_SPECS_SLOW, 'several git operations per test (17 §4.1)');

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro', 'delivery.defaultStrategy': 'squash' }),
);
test.afterEach(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

/** A project whose repository has the user's identity and a bare `origin` that main is pushed to. */
async function projectWithOrigin(request: Parameters<typeof createProject>[0]) {
  const project = await createProject(request, null);
  const origin = mkdtempSync(join(tmpdir(), 'aw-e2e-origin-'));
  git(origin, 'init', '-q', '--bare');
  git(project.repoPath, 'config', 'user.name', 'Zhang Wei');
  git(project.repoPath, 'config', 'user.email', 'zhang@example.com');
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = "hi";\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-q', '-m', 'add greet');
  git(project.repoPath, 'remote', 'add', 'origin', origin);
  git(project.repoPath, 'push', '-q', '-u', 'origin', 'main');
  return { project, origin };
}

const workbench = (page: Page, project: E2EProject, search = '') => page.goto(`/git/${project.id}${search}`);
/** The user edited files outside the app and came back to it: the workbench reads the worktree again. */
const backToApp = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
/** A view of the workbench's left rail; its name ends with the view's count. */
const railView = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\s*\\d*$`) });
const toast = (page: Page, text: string) => expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();

async function stageAndCommit(page: Page, file: string, subject: string): Promise<void> {
  await page.getByRole('button', { name: `暂存 ${file}` }).click();
  await page.getByRole('textbox', { name: '提交信息标题' }).fill(subject);
  await page.getByRole('button', { name: '提交 1 个文件' }).click();
  await toast(page, '已提交');
}

test('J24 Git 工作台：暂存 → AI 草拟并提交 → 新建分支再提交 → AI 审查分支并定位问题 → 压缩合并到 main → 推送', async ({
  page,
  request,
}) => {
  const { project, origin } = await projectWithOrigin(request);
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = "hello";\n');
  await workbench(page, project);
  await expect(page.getByTestId('git-status')).toContainText('1 个未提交改动');

  // Stage, let the AI draft the message, commit as the user.
  await page.getByRole('button', { name: '暂存 greet.ts' }).click();
  await expect(page.getByTestId('git-changes')).toContainText('已暂存 1');
  await queueCodeReviewerTurn(request, project, [
    { type: 'callTool', name: 'submit_commit_message', args: { subject: 'feat: say hello', body: 'Friendlier.' } },
  ]);
  await page.getByRole('button', { name: 'AI 草拟' }).click();
  await expect(page.getByRole('textbox', { name: '提交信息标题' })).toHaveValue('feat: say hello');
  await page.getByRole('button', { name: '提交 1 个文件' }).click();
  await toast(page, '已提交');
  expect(git(project.repoPath, 'log', '-1', '--format=%an|%s|%b')).toBe('Zhang Wei|feat: say hello|Friendlier.');

  // A branch of the user's own, switched to, with one more commit.
  await page.getByRole('button', { name: '当前分支' }).click();
  await page.getByRole('menuitem', { name: '新建分支' }).click();
  await page.getByRole('textbox', { name: '分支名' }).fill('feature/bye');
  await page.getByRole('button', { name: '创建' }).click();
  await toast(page, '已创建分支 feature/bye');
  await expect(page.getByTestId('git-status')).toContainText('feature/bye');
  writeFileSync(join(project.repoPath, 'bye.ts'), ['export const a = 1;', 'export const b = 2;', ''].join('\n'));
  await backToApp(page);
  await stageAndCommit(page, 'bye.ts', 'feat: say bye');

  // The AI reviews the branch; a finding opens the diff at its line.
  await queueCodeReviewerTurn(request, project, [
    {
      type: 'callTool',
      name: 'submit_findings',
      args: {
        summary: '一个小问题。',
        findings: [
          {
            severity: 'major',
            category: 'correctness',
            path: 'bye.ts',
            line: 2,
            title: '常量命名不清楚',
            description: '`b` 说明不了用途。',
          },
        ],
      },
    },
  ]);
  await railView(page, '分支').click();
  const row = page.getByTestId('git-branch').filter({ hasText: 'feature/bye' });
  await row.getByRole('button', { name: '更多 · feature/bye' }).click();
  await page.getByRole('menuitem', { name: 'AI 审查' }).click();
  const review = page.getByTestId('git-review');
  await expect(review.getByTestId('git-review-verdict')).toContainText('建议合并前修复', {
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  await review.getByRole('button', { name: 'bye.ts:2' }).click();
  await expect(page.locator('[data-focus]')).toContainText('export const b = 2;');

  // Back on main, the branch is squashed into it as the user, then main is pushed after its confirmation.
  await railView(page, '分支').click();
  await page.getByTestId('git-branch').filter({ hasText: /^main/ }).getByRole('button', { name: '切换' }).click();
  await toast(page, '已切换到 main');
  await row.getByRole('button', { name: '合并到 main' }).click();
  const merge = page.getByRole('dialog', { name: '合并到 main' });
  await merge.getByRole('radio', { name: /压缩为一个提交/ }).check();
  await merge.getByRole('textbox', { name: '提交信息' }).fill('Say bye');
  await merge.getByRole('button', { name: '合并' }).click();
  await toast(page, '已合并到 main');
  expect(git(project.repoPath, 'log', '-1', '--format=%an|%s|%P', 'main')).toMatch(/^Zhang Wei\|Say bye\|\S+$/);

  await page.getByTestId('git-status').getByRole('button', { name: /^推送/ }).click();
  const push = page.getByRole('dialog', { name: '推送 main 到 origin？' });
  await expect(push.getByTestId('git-push-commits')).toContainText('Say bye');
  await push.getByRole('button', { name: '推送' }).click();
  await toast(page, '已推送 main');
  expect(git(origin, 'rev-parse', 'main')).toBe(git(project.repoPath, 'rev-parse', 'main'));
});

test('J24 合并冲突交给 AI：工作台合并冲突 → 合并任务解决冲突 → 在结果卡合并 → main 有两边的改动', async ({
  page,
  request,
}) => {
  const { project } = await projectWithOrigin(request);
  git(project.repoPath, 'checkout', '-q', '-b', 'clash');
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = "hey";\n');
  git(project.repoPath, 'commit', '-q', '-am', 'hey');
  git(project.repoPath, 'checkout', '-q', 'main');
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = "hello";\n');
  git(project.repoPath, 'commit', '-q', '-am', 'hello');

  await workbench(page, project, '?view=branches');
  await page
    .getByTestId('git-branch')
    .filter({ hasText: 'clash' })
    .getByRole('button', { name: '合并到 main' })
    .click();
  await page.getByRole('dialog', { name: '合并到 main' }).getByRole('button', { name: '合并' }).click();
  const conflict = page.getByRole('dialog', { name: '合并有冲突，main 没有改动' });
  await expect(conflict.getByTestId('git-merge-conflict')).toBeVisible();
  await expect(conflict).toContainText('greet.ts');

  const resolved = 'export const greet = "hello, hey";\n';
  await queueTurn(request, project, { title: '解决合并冲突' }, [
    { type: 'edit', file: 'greet.ts', content: resolved },
    submitResult('两边都保留了'),
  ]);
  await conflict.getByRole('button', { name: '交给 AI 解决' }).click();
  const result = page.getByTestId('result-card');
  await expect(result.getByRole('button', { name: '合并到 main' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe(resolved.trim());
});

test('主页开始任务：总能看到并选择项目，基于分支只列所选项目的分支，换项目后回到默认分支', async ({
  page,
  request,
}) => {
  const a = await createProject(request, null);
  const b = await createProject(request, null);
  git(a.repoPath, 'branch', 'feature/only-in-a');
  await page.goto(`/?projectId=${a.id}`);
  await page.getByRole('group', { name: '直接开始' }).getByRole('button', { name: '修 Bug', exact: true }).click();
  const project = page.getByLabel('项目', { exact: true });
  await expect(project).toHaveValue(a.id);

  await page.getByText('更多选项').click();
  const branch = page.getByLabel('基于分支');
  await expect(branch.locator('option').first()).toHaveText(/^项目默认分支（.+）$/);
  await branch.selectOption('feature/only-in-a');

  await project.selectOption(b.id);
  await expect(branch).toHaveValue('');
  await expect(branch.locator('option', { hasText: 'feature/only-in-a' })).toHaveCount(0);

  // What is sent: the task is for b on its default branch, not on the branch picked in a. Nothing is created.
  let sent: Record<string, unknown> | undefined;
  await page.route(`**${API_PREFIX}/tasks`, (route) => {
    sent = route.request().postDataJSON();
    return route.abort();
  });
  await page.getByLabel('需求').fill('只看请求');
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect.poll(() => sent).toMatchObject({ projectId: b.id });
  expect(sent).not.toHaveProperty('baseBranch');
});
