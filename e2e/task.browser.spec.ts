import { expect, type Page, test } from '@playwright/test';
import { createProject, type E2EProject, passReview, patchSettings, queueTurn, submitResult } from './helpers.ts';

// Journeys J1–J4 (07 §5): the AI sessions are played by FakeOpencode, scripted per step.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

/** Home page of the project (the select writes the same `?projectId=`), then workflow, requirement and start. */
async function startTask(page: Page, project: E2EProject, workflow: RegExp, requirement: string) {
  await page.goto(`/?projectId=${project.id}`);
  const projectSelect = page.getByLabel('项目', { exact: true });
  if ((await projectSelect.count()) > 0) await expect(projectSelect).toHaveValue(project.id);
  await page.getByRole('group', { name: '流程' }).getByRole('button', { name: workflow }).click();
  await page.getByLabel('需求').fill(requirement);
  await page.getByRole('button', { name: /^开始/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/);
}

test('J1 简单模式：选项目 → 新功能流程 → 输入需求 → 开始 → 结果卡显示改动与检查通过', async ({ page, request }) => {
  const project = await createProject(request, 'true');
  await queueTurn(request, project, { agent: 'aw-planner' }, [
    {
      type: 'callTool',
      name: 'submit_plan',
      args: {
        summary: '实现问候函数，然后整体验证。',
        nodes: [
          { key: 'impl', title: '实现问候函数', role: 'developer', instructions: 'Add greet()' },
          { key: 'final_verify', title: '整体验证', role: 'tester', instructions: 'Verify', depends_on: ['impl'] },
        ],
      },
    },
  ]);
  await queueTurn(request, project, { title: '实现问候函数' }, [
    { type: 'edit', file: 'greet.ts', content: 'export const greet = () => "你好";\n' },
    submitResult('新增 greet()'),
  ]);
  await queueTurn(request, project, { title: '整体验证' }, [submitResult('检查通过')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /新功能开发/, '新增问候函数\n返回中文问候语。');
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('检查全部通过');
  await expect(result).toContainText('改动 1 个文件 +1 −0');
  await expect(result).toContainText('greet.ts');
  await expect(page.getByTestId('task-page').getByText('待合并', { exact: true }).first()).toBeVisible();
});

test('J2 AI 阻塞提问 → 在需要你处理中作答 → 节点继续 → 完成', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    {
      type: 'callTool',
      name: 'ask_user',
      args: { question: '问题出现在哪个环境？', blocking: true },
    },
  ]);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('预发环境的时区导致')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('修复时区处理')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /修 Bug/, '订单时间显示错了');
  await expect(page.getByText('需要你处理', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /需要你处理（\d+）/ }).click();
  const drawer = page.getByRole('dialog', { name: '需要你处理' });
  const question = drawer.getByTestId('inbox-question').filter({ hasText: '问题出现在哪个环境？' });
  await question.getByLabel('输入你的回答……').fill('预发环境');
  await question.getByRole('button', { name: '提交' }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤');
});

test('J3 权限请求 → 允许一次 → 继续', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    { type: 'permission', permission: 'bash', patterns: ['rm -rf dist'] },
    submitResult('清理后复现了问题'),
  ]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('已修复')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /修 Bug/, '构建产物残留导致测试失败');
  const permission = page.getByTestId('inbox-permission');
  await expect(permission).toContainText('rm -rf dist');
  await permission.getByRole('button', { name: '允许一次' }).click();
  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤');
});

test('J4 检查失败 → 自动重试成功；另一步骤预算耗尽 → 任务失败 → 用户重试 → 完成', async ({ page, request }) => {
  await patchSettings(request, { 'node.maxAttempts': 2 });
  try {
    const project = await createProject(request, 'test -f ok.txt');
    await queueTurn(request, project, { agent: 'aw-planner' }, [
      {
        type: 'callTool',
        name: 'submit_plan',
        args: {
          summary: '两个独立的步骤，最后整体验证。',
          nodes: [
            { key: 'a', title: '生成标记文件', role: 'developer', instructions: 'Create ok.txt' },
            { key: 'b', title: '更新说明', role: 'developer', instructions: 'Update docs' },
            { key: 'final_verify', title: '整体验证', role: 'tester', instructions: 'Verify', depends_on: ['a', 'b'] },
          ],
        },
      },
    ]);
    // a: the first result fails the check, the retry passes. b: no turn queued, so its attempts end without a result.
    await queueTurn(request, project, { title: '生成标记文件' }, [submitResult('第一次：忘了生成文件')]);
    await queueTurn(request, project, { title: '生成标记文件' }, [
      { type: 'edit', file: 'ok.txt', content: 'ok\n' },
      submitResult('第二次：已生成 ok.txt'),
    ]);

    await startTask(page, project, /新功能开发/, '生成标记文件并更新说明');
    const failure = page.getByTestId('failure-panel');
    await expect(failure).toContainText('「更新说明」多次尝试仍未通过检查');
    await expect(page.getByTestId('step-a')).toContainText('完成');

    await queueTurn(request, project, { title: '更新说明' }, [submitResult('已更新说明')]);
    await queueTurn(request, project, { title: '整体验证' }, [submitResult('全部通过')]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
    await failure.getByRole('button', { name: '重试' }).click();
    await expect(page.getByTestId('result-card')).toContainText('检查全部通过');
  } finally {
    await patchSettings(request, { 'node.maxAttempts': 3 });
  }
});
