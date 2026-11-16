import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  passReview,
  patchSettings,
  pickWorkflow,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test.beforeEach(({ request }) => patchSettings(request, { 'ui.mode': 'pro' }));
test.afterAll(({ request }) => patchSettings(request, { 'ui.mode': 'simple' }));

test('将待确认的 AI 计划保存为固定流程', async ({ page, request }) => {
  const project = await createProject(request, 'true');
  await queueTurn(request, project, { agent: 'aw-planner' }, [
    {
      type: 'callTool',
      name: 'submit_plan',
      args: {
        summary: '实现并验证',
        nodes: [
          { key: 'impl', title: '实现功能', role: 'tester', instructions: 'Implement' },
          { key: 'final_verify', title: '整体验证', role: 'tester', instructions: 'Verify', depends_on: ['impl'] },
        ],
      },
    },
  ]);
  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, '新功能开发');
  await page.getByLabel('需求').fill('实现功能');
  await page.getByLabel('运行前让我确认计划').check();
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect(page.getByRole('link', { name: '存为流程模板' })).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  const sourceUrl = page.url();
  await page.getByRole('button', { name: '编辑计划' }).click();
  await page.getByTestId('step-impl').click();
  await page.getByTestId('plan-node-form').getByLabel('标题').fill('实现功能第二版');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('AI 的计划 · 第 2 版')).toBeVisible();
  const taskId = new URL(sourceUrl).pathname.split('/').at(-1);
  await page.goto(`/workflows/new?task=${taskId}&version=1`);
  await expect(page.getByText(/来源任务.*计划第 1 版/)).toBeVisible();
  await expect(page.getByTestId('step-impl')).toContainText('实现功能');
  await expect(page.getByTestId('step-impl')).not.toContainText('第二版');
  await page.goto(sourceUrl);
  await page.getByRole('link', { name: '存为流程模板' }).click();
  await expect(page.getByText(/来源任务.*计划第 2 版/)).toBeVisible();
  await expect(page.getByTestId('step-impl')).toContainText('实现功能第二版');
  await expect(page.getByTestId('step-impl')).toBeVisible();
  await page.getByLabel('流程标识').fill('from_plan_test');
  await page.getByLabel('名称').fill('计划复用测试');
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page).toHaveURL(/\/workflows\/from_plan_test$/);
  const versions = await (
    await request.get(`${API_BASE}/workflows/by-key/from_plan_test/versions`, { headers: AUTH })
  ).json();
  const saved = await (await request.get(`${API_BASE}/workflows/${versions.items[0].id}`, { headers: AUTH })).json();
  expect(saved.planning).toBe('fixed');
  expect(
    saved.definition.template.nodes.map((node: { key: string; dependsOn: string[] }) => [node.key, node.dependsOn]),
  ).toEqual([
    ['impl', []],
    ['final_verify', ['impl']],
  ]);
  expect(saved.definition.allowedRoles).toEqual(['tester', 'developer']);
  expect(JSON.stringify(saved.definition)).toContain('$PROJECT_CHECK');

  // The source task completes independently, and its finished result still opens the original plan version.
  await queueTurn(request, project, { title: '实现功能第二版' }, [
    { type: 'edit', file: 'first.txt', content: 'first\n' },
    submitResult('完成实现'),
  ]);
  await queueTurn(request, project, { title: '整体验证' }, [submitResult('完成验证')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await page.goto(sourceUrl);
  await page.getByRole('button', { name: '确认并开始' }).click();
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
  await result.getByRole('button', { name: '合并到 main' }).click();
  await expect(result.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  await page.getByRole('link', { name: '存为流程模板' }).click();
  await expect(page.getByText(/来源任务.*计划第 2 版/)).toBeVisible();
  await expect(page.getByTestId('step-impl')).toBeVisible();

  // A new task executes the saved fixed graph without another planner turn.
  await queueTurn(request, project, { title: '实现功能第二版' }, [
    { type: 'edit', file: 'second.txt', content: 'second\n' },
    submitResult('完成另一项需求'),
  ]);
  await queueTurn(request, project, { title: '整体验证' }, [submitResult('完成验证')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
  await page.goto(`/?projectId=${project.id}`);
  await pickWorkflow(page, '计划复用测试');
  await page.getByLabel('需求').fill('完成另一项需求');
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('result-card')).toContainText('second.txt');
  const secondTaskId = new URL(page.url()).pathname.split('/').at(-1);
  const second = await (await request.get(`${API_BASE}/tasks/${secondTaskId}`, { headers: AUTH })).json();
  expect(
    second.nodes.map((node: { key: string; roleKey: string; dependsOn: string[] }) => [
      node.key,
      node.roleKey,
      node.dependsOn,
    ]),
  ).toEqual([
    ['impl', 'tester', []],
    ['final_verify', 'developer', ['impl']],
  ]);
  const verify = second.nodes.find((node: { key: string }) => node.key === 'final_verify');
  const detail = await (
    await request.get(`${API_BASE}/tasks/${secondTaskId}/nodes/${verify.id}`, { headers: AUTH })
  ).json();
  expect(detail.acceptance.checks).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'command', command: 'true' })]),
  );
});
