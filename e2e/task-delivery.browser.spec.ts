import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignSectionKind, DesignStatus, getDesignOp, McpToolName, OPENCODE_AGENT_NAME, ThemeId } from '@aw/shared';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
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
  patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple', 'delivery.defaultStrategy': 'squash' }),
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

const greetingModule = '问候语模块';

async function greetingDesign(request: APIRequestContext, project: E2EProject) {
  writeFileSync(join(project.repoPath, 'greet.ts'), 'export const greet = () => "您好";\n');
  git(project.repoPath, 'add', 'greet.ts');
  git(project.repoPath, 'commit', '-m', 'Add greeting');

  const created = await request.post(`${API_BASE}/designs`, {
    headers: AUTH,
    data: { projectId: project.id, aiReviewEnabled: false },
  });
  await expect(created).toBeOK();
  const { id, title } = getDesignOp.output.parse(await created.json());
  const url = `${API_BASE}/designs/${id}`;
  const outline = await request.put(`${url}/outline`, {
    headers: AUTH,
    data: {
      sections: [{ kind: DesignSectionKind.Module, title: greetingModule, scopePaths: ['greet.ts'], selected: true }],
    },
  });
  await expect(outline).toBeOK();
  const [section] = getDesignOp.output.parse(await outline.json()).sections;
  if (section === undefined) throw new Error('Missing greeting section');
  await expect(
    await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
      headers: AUTH,
      data: {
        match: { title, agent: OPENCODE_AGENT_NAME.designer },
        steps: [
          {
            type: 'callTool',
            name: McpToolName.SubmitDesignSection,
            args: {
              sectionId: section.id,
              summary: '供界面显示默认问候语。',
              blocks: [{ type: 'markdown', markdown: '供界面显示默认问候语。' }],
              files: [{ relPath: 'greet.ts', responsibility: '返回默认问候语', symbols: [] }],
              diagrams: [],
            },
          },
        ],
      },
    }),
  ).toBeOK();
  await expect(await request.post(`${url}/generate`, { headers: AUTH, data: {} })).toBeOK();
  const read = async () => {
    const response = await request.get(url, { headers: AUTH });
    await expect(response).toBeOK();
    return getDesignOp.output.parse(await response.json());
  };
  await expect.poll(async () => (await read()).status).toBe(DesignStatus.Ready);
  return { id, read };
}

test('J5 合并到 main（squash）→ 主分支有提交、worktree 已清理、任务已完成', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  const design = await greetingDesign(request, project);
  const initialRuns = (await design.read()).runs.map(({ id }) => id);
  await page.setViewportSize({ width: 1440, height: 1050 });
  const taskUrl = await fixInReview(page, request, project, '问候语写错了', 'export const greet = () => "你好";\n');
  const result = page.getByTestId('result-card');

  const impact = result.locator('summary').filter({ hasText: '设计影响初筛' });
  await expect(impact).toHaveText('设计影响初筛：命中 1 个模块 / 0 条交易 · 精确匹配快照');
  await impact.click();
  const moduleLink = result.getByRole('link', { name: greetingModule, exact: true });
  await expect(moduleLink).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Codex);
  await page.screenshot({ path: info.outputPath('delivery-design-impact-light.png'), animations: 'disabled' });
  await moduleLink.click();
  await expect(page).toHaveURL(new RegExp(`/designs/${design.id}\\?targetKind=section`));
  await expect(
    page.getByRole('region', { name: '设计正文' }).getByRole('heading', { name: greetingModule }),
  ).toBeVisible();
  await page.goto(taskUrl);

  const stalenessUrl = `${API_BASE}/designs/${design.id}/staleness`;
  const stalenessReads: string[] = [];
  page.on('request', (request) => {
    if (request.url() === stalenessUrl) stalenessReads.push(request.method());
  });
  // The changes can be read line by line before merging.
  await result.getByRole('button', { name: '查看改动' }).click();
  const changes = page.getByRole('dialog', { name: '改动' });
  await expect(changes.getByTestId('diff-view')).toContainText('export const greet = () => "你好";');
  await changes.getByRole('button', { name: '并排视图' }).click();
  await expect(changes.getByTestId('diff-view')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(stalenessReads).toEqual([]);

  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('task-page').getByText('已完成', { exact: true }).first()).toBeVisible();
  const staleness = result.getByRole('status').filter({ hasText: '项目设计有 1 个文件变动（影响 1 章）' });
  await expect(staleness).toBeVisible();
  expect(stalenessReads).toEqual(['GET']);
  await patchSettings(request, { 'ui.theme': ThemeId.Default });
  await expect(page.locator('html')).toHaveAttribute('data-theme', ThemeId.Default);
  await staleness.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('delivery-design-stale-dark.png'), animations: 'disabled' });
  expect(stalenessReads).toEqual(['GET']);

  expect(git(project.repoPath, 'log', '-1', '--format=%s', 'main')).toMatch(/^问候语写错了 \(T-\d+\)$/);
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe('export const greet = () => "你好";');
  // The worktree and branch are cleaned up after the merge is reported.
  await expect
    .poll(() => git(project.repoPath, 'worktree', 'list', '--porcelain').match(/^worktree /gm))
    .toHaveLength(1);
  await expect.poll(() => git(project.repoPath, 'branch', '--list', 'aw/*')).toBe('');
  // Delivery's recorded commits keep the same diff even after the worktree is gone and main moves.
  writeFileSync(join(project.repoPath, 'later.txt'), 'later\n');
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-qm', 'later');
  await result.getByRole('button', { name: '查看改动' }).click();
  const historical = page.getByRole('dialog', { name: '改动' });
  await expect(historical.getByTestId('diff-view')).toContainText('export const greet = () => "你好";');
  await expect(historical).not.toContainText('later.txt');
  expect(stalenessReads).toEqual(['GET']);

  await page.reload();
  await expect(result.getByRole('status').filter({ hasText: '项目设计有 2 个文件变动' })).toBeVisible();
  expect(stalenessReads).toEqual(['GET', 'GET']);
  await result.getByRole('link', { name: '打开项目设计去增量更新' }).click();
  await expect(page).toHaveURL(new RegExp(`/designs/${design.id}$`));
  await expect(page.getByRole('button', { name: '按变更增量更新' })).toBeVisible();
  expect((await design.read()).runs.map(({ id }) => id)).toEqual(initialRuns);
});

test('合入非默认分支时不检查项目设计过期', async ({ page, request }) => {
  await patchSettings(request, { 'ui.mode': 'pro' });
  const project = await createProject(request, null);
  const design = await greetingDesign(request, project);
  git(project.repoPath, 'branch', 'release-preview');
  await fixInReview(page, request, project, '先把问候语合入预览分支', 'export const greet = () => "你好";\n');
  const result = page.getByTestId('result-card');
  const stalenessUrl = `${API_BASE}/designs/${design.id}/staleness`;
  const stalenessReads: string[] = [];
  page.on('request', (request) => {
    if (request.url() === stalenessUrl) stalenessReads.push(request.method());
  });

  await result.getByRole('button', { name: '合并选项…' }).click();
  const options = page.getByRole('dialog', { name: '合并选项' });
  await options.getByLabel('目标分支').fill('release-preview');
  await options.getByRole('button', { name: '合并', exact: true }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 release-preview', {
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  expect(git(project.repoPath, 'show', 'release-preview:greet.ts')).toBe('export const greet = () => "你好";');
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe('export const greet = () => "您好";');
  await page.reload();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 release-preview');
  await expect(result.getByRole('link', { name: '打开项目设计去增量更新' })).toHaveCount(0);
  expect(stalenessReads).toEqual([]);
});

test('无法运行的命令跳过后，从结果卡读取当次检查证据', async ({ page, request }) => {
  const project = await createProject(request, 'aw-command-that-does-not-exist');
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('找到了原因')]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'edit', file: 'greet.ts', content: 'export const greet = () => "你好";\n' },
    submitResult('已修复'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await startTask(page, project, /修 Bug/, '检查不可运行的命令');
  const failure = page.getByTestId('failure-panel');
  await expect(failure.getByRole('button', { name: '跳过这项检查…' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await failure.getByRole('button', { name: '跳过这项检查…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '跳过并继续' }).click();
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('已跳过', { timeout: TASK_RUN_TIMEOUT_MS });
  const evidence = result.getByTestId('check-evidence-row').first();
  const evidenceRoute = '**/tasks/*/check-evidence/*';
  await page.route(evidenceRoute, (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Evidence missing' } } }),
  );
  await evidence.getByRole('button', { name: '查看证据' }).click();
  await expect(evidence.getByText('证据不可用或结果已更新，请重新打开任务。')).toBeVisible();
  await expect(evidence.getByRole('button', { name: '重试' })).toHaveCount(0);
  await evidence.getByRole('button', { name: '收起证据' }).click();
  await page.unroute(evidenceRoute);

  await page.route(evidenceRoute, (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Temporary failure' } } }),
  );
  await evidence.getByRole('button', { name: '查看证据' }).click();
  const retry = evidence.getByRole('alert').getByRole('button', { name: '重试' });
  await expect(retry).toBeVisible();
  await page.unroute(evidenceRoute);
  await retry.click();
  await evidence.getByText('aw-command-that-does-not-exist').click();
  await expect(evidence).toContainText('已跳过');
  await expect(evidence.getByText('已跳过本次检查，没有命令输出。')).toBeVisible();
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
  // Three at once need three background slots (D186): sessions other journeys left on the shared backend may hold
  // some of the default four, and a task queued behind them starts only once another waits for its permission, too
  // late for the inbox to show all three in time on a slow runner.
  await patchSettings(request, { 'scheduler.maxConcurrentAttempts': 8 });
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
  await patchSettings(request, { 'scheduler.maxConcurrentAttempts': 4 });
  // The last merge's worktree is removed after the merge is reported.
  await expect
    .poll(() => git(project.repoPath, 'worktree', 'list', '--porcelain').match(/^worktree /gm))
    .toHaveLength(1);
});

test('根工作区留在 feature 时，默认分支交付按实际合入提交检查设计', async ({ page, request }, info) => {
  const project = await createProject(request, null);
  const design = await greetingDesign(request, project);
  const initialRuns = (await design.read()).runs.map(({ id }) => id);
  const baseline = git(project.repoPath, 'rev-parse', 'main');
  git(project.repoPath, 'checkout', '-b', 'feature');
  expect(git(project.repoPath, 'status', '--porcelain')).toBe('');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await fixInReview(page, request, project, '合入主分支的问候语', 'export const greet = () => "你好";\n');
  const result = page.getByTestId('result-card');
  const stalenessUrl = new URL(`${API_BASE}/designs/${design.id}/staleness`).pathname;
  const stalenessReads: { method: string; commitSha: string | null }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === stalenessUrl) {
      stalenessReads.push({ method: request.method(), commitSha: url.searchParams.get('commitSha') });
    }
  });

  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  const merge = git(project.repoPath, 'rev-parse', 'main');
  expect(merge).not.toBe(baseline);
  expect(git(project.repoPath, 'show', 'main:greet.ts')).toBe('export const greet = () => "你好";');
  expect(git(project.repoPath, 'branch', '--show-current')).toBe('feature');
  expect(git(project.repoPath, 'rev-parse', 'HEAD')).toBe(baseline);
  expect(git(project.repoPath, 'status', '--porcelain')).toBe('');

  const notice = result.getByRole('status').filter({ hasText: '本次合入提交相对项目设计快照' });
  await expect(notice).toContainText('有 1 个文件变动（影响 1 章）');
  await expect(notice).toContainText('切换到 main 后再增量更新。');
  expect(stalenessReads).toEqual([{ method: 'GET', commitSha: merge }]);
  await notice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('delivery-design-merge-commit-light.png'), animations: 'disabled' });
  await notice.getByRole('link', { name: '打开项目设计', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/designs/${design.id}$`));
  await expect(page.getByRole('region', { name: '设计正文' })).toBeVisible();
  expect((await design.read()).runs.map(({ id }) => id)).toEqual(initialRuns);
});
