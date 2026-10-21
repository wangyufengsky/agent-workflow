import { expect, test } from '@playwright/test';
import {
  createProject,
  git,
  passReview,
  patchSettings,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journey J19 (07 §5, 22): a schedule for the unit-test workflow, run once by hand; its result waits in「需要你处理」
// for the user, who merges it; the schedule is then paused. Runs on time are driven by a fake clock in the
// integration tests (schedules.int.test.ts), never by waiting here.

test.beforeEach(({ request }) =>
  patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple', 'delivery.defaultStrategy': 'squash' }),
);

const REQUIREMENT = '为最近改动的代码补充单元测试，覆盖主要行为与边界情况。';

test('J19 主页「补单元测试」的「定时」→ 每周一、五 03:30 → 立即运行一次 → 「需要你处理」注明来自定时任务 → 合并 → 暂停', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '分析测试缺口' }, [submitResult('列出了缺少的测试')]);
  await queueTurn(request, project, { title: '编写测试' }, [
    { type: 'edit', file: 'greet.test.ts', content: '// tests of greet\n' },
    submitResult('补了 greet 的测试'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await page.goto(`/?projectId=${project.id}`);
  await page.getByRole('link', { name: '定时运行「补单元测试」' }).click();
  await expect(page.getByRole('heading', { name: '新建定时任务' })).toBeVisible();
  await expect(page.getByLabel('要做什么')).toHaveValue(REQUIREMENT);
  await page.getByRole('button', { name: '每周' }).click();
  // Monday is chosen to start with.
  await expect(page.getByRole('button', { name: '周一' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '周五' }).click();
  await page.getByLabel('时间').fill('03:30');
  await page.getByRole('button', { name: '创建定时任务' }).click();

  const schedule = page.getByTestId('schedule-page');
  await expect(schedule.getByRole('heading', { name: REQUIREMENT })).toBeVisible();
  await expect(schedule).toContainText('每周一、五 03:30');
  await expect(page.getByTestId('schedule-next')).toContainText('下次运行：');
  await expect(schedule).toContainText('还没有运行过');

  await page.getByRole('button', { name: '立即运行一次' }).click();
  const run = page.getByTestId('schedule-run');
  await expect(run).toHaveCount(1);
  await expect(run).toContainText('手动');
  // While its task has not ended, the schedule does not run again.
  await expect(page.getByRole('button', { name: '立即运行一次' })).toBeDisabled();
  await expect(run).toContainText('待合并', { timeout: 3 * TASK_RUN_TIMEOUT_MS });

  await page.goto('/inbox');
  // Other specs' tasks wait in the same backend's inbox: this one is told apart by the schedule it names.
  const item = page.getByTestId('inbox-delivery').filter({ hasText: `定时任务「${REQUIREMENT}」` });
  await expect(item).toHaveCount(1);
  await item.getByRole('link', { name: '去查看' }).click();
  const result = page.getByTestId('result-card');
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  expect(git(project.repoPath, 'show', 'main:greet.test.ts')).toBe('// tests of greet');

  await page.goto('/schedules');
  await page.getByTestId('schedule-card').filter({ hasText: project.name }).click();
  await expect(page.getByTestId('schedule-run')).toContainText('已完成');
  await expect(page.getByRole('button', { name: '立即运行一次' })).toBeEnabled();
  await page.getByRole('button', { name: '暂停' }).click();
  await expect(page.getByTestId('schedule-page')).toContainText('已暂停');
  await expect(page.getByTestId('schedule-next')).toHaveText('已暂停，不会自动运行');
  await expect(page.getByRole('button', { name: '恢复' })).toBeVisible();
});
