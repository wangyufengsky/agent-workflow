import { expect, test } from '@playwright/test';
import {
  createProject,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// Journeys J1–J4 (07 §5): the AI sessions are played by FakeOpencode, scripted per step.

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

test('J1 简单模式：选项目 → 新功能流程 → 输入需求 → 开始 → 结果卡显示改动与检查通过 → 步骤摘要与大视图 diff', async ({
  page,
  request,
}) => {
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
    { type: 'edit', file: 'greet.test.ts', content: 'assert(greet() === "你好");\n' },
    submitResult('## 实现思路\n\n新增 `greet()`，返回中文问候语。\n\n```ts\nexport const greet = () => "你好";\n```'),
  ]);
  await queueTurn(request, project, { title: '整体验证' }, [submitResult('检查通过')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /新功能开发/, '新增问候函数\n返回中文问候语。');
  const result = page.getByTestId('result-card');
  await expect(result).toContainText('检查全部通过', { timeout: TASK_RUN_TIMEOUT_MS });
  await expect(result).toContainText('改动 2 个文件 +2 −0');
  await expect(result).toContainText('greet.ts');
  await expect(page.getByTestId('task-page').getByText('待合并', { exact: true }).first()).toBeVisible();

  // The step's summary in the side panel is Markdown, not its source (14 §2.2).
  await page.getByText('查看步骤', { exact: true }).click();
  await page.getByTestId('step-impl').click();
  const side = page.getByTestId('task-side');
  await expect(side.getByRole('heading', { name: '实现思路' })).toBeVisible();
  await expect(side.locator('pre code')).toHaveText('export const greet = () => "你好";');
  await expect(side).not.toContainText('##');

  // The step's changes open almost full screen; j and ↑ switch files in the list's order (14 §2.3).
  await side.getByRole('button', { name: '查看详情' }).click();
  await page.getByRole('tab', { name: '改动' }).click();
  await page.getByRole('button', { name: '放大查看' }).click();
  const large = page.getByRole('dialog', { name: '改动 · 实现问候函数' });
  const files = large.getByRole('navigation', { name: '改动文件' });
  await expect(files.getByRole('button', { pressed: true })).toContainText('greet.test.ts');
  await expect(large.getByTestId('diff-view')).toContainText('assert(greet() === "你好");');
  await page.keyboard.press('j');
  await expect(files.getByRole('button', { pressed: true })).toContainText('greet.ts');
  await expect(large.getByTestId('diff-view')).toContainText('export const greet = () => "你好";');
  await page.keyboard.press('ArrowUp');
  await expect(files.getByRole('button', { pressed: true })).toContainText('greet.test.ts');
  await page.keyboard.press('Escape');
  await expect(large).toBeHidden();
});

test('J2 AI 阻塞提问 → 在需要你处理中作答 → 节点继续 → 完成', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    {
      type: 'callTool',
      name: 'ask_user',
      args: {
        question: '问题出现在哪个环境？',
        blocking: true,
        options: ['预发 `staging`', '**生产**'],
        default_assumption: '按 **预发** 环境处理',
      },
    },
  ]);
  await queueTurn(request, project, { title: '定位根因' }, [submitResult('预发环境的时区导致')]);
  await queueTurn(request, project, { title: '修复' }, [submitResult('修复时区处理')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  // Asked rather than assumed, so the card shows the default assumption; the task keeps the setting it started with.
  await patchSettings(request, { 'ai.askOnUncertainty': true });
  await startTask(page, project, /修 Bug/, '订单时间显示错了');
  await patchSettings(request, { 'ai.askOnUncertainty': false });
  await expect(page.getByText('需要你处理', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /需要你处理（\d+）/ }).click();
  const drawer = page.getByRole('dialog', { name: '需要你处理' });
  const question = drawer.getByTestId('inbox-question').filter({ hasText: '问题出现在哪个环境？' });
  // Everything the model wrote on the card is Markdown, not its source (14 §2.2).
  await expect(question.getByRole('button', { name: '预发 staging' }).locator('code')).toHaveText('staging');
  await expect(question.locator('strong', { hasText: '预发' })).toBeVisible();
  await expect(question).not.toContainText('**');
  await question.getByLabel('输入你的回答……').fill('预发环境');
  await question.getByRole('button', { name: '提交' }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
});

test('J3 权限请求 → 允许一次 → 继续；总是允许 → 记到项目 → 专业模式的项目设置中撤销（D101）', async ({
  page,
  request,
}) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { title: '定位根因' }, [
    { type: 'permission', permission: 'bash', patterns: ['rm -rf dist'] },
    submitResult('清理后复现了问题'),
  ]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'permission', permission: 'bash', patterns: ['./scripts/build.sh --clean'] },
    submitResult('已修复'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /修 Bug/, '构建产物残留导致测试失败');
  const permission = page.getByTestId('inbox-permission');
  await expect(permission).toContainText('rm -rf dist');
  await permission.getByRole('button', { name: '允许一次' }).click();
  await expect(permission).toContainText('./scripts/build.sh --clean');
  await expect(permission).toContainText('「总是允许」会为本项目记住 ./scripts/build.sh --clean *');
  await permission.getByRole('button', { name: '总是允许' }).click();
  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });

  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.goto(`/projects/${project.id}`);
  const allowed = page.getByRole('list', { name: '总是允许的命令' });
  await expect(allowed).toContainText('./scripts/build.sh --clean *');
  await allowed.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('还没有总是允许的命令。')).toBeVisible();
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
          summary: '先生成标记文件，再更新说明，最后整体验证。',
          nodes: [
            { key: 'a', title: '生成标记文件', role: 'developer', instructions: 'Create ok.txt' },
            // After a: otherwise b may use up its budget (failing the task, which stops dispatching) before a's retry
            // starts, depending on how long a's check takes.
            { key: 'b', title: '更新说明', role: 'developer', instructions: 'Update docs', depends_on: ['a'] },
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
    await expect(failure).toContainText('执行步骤「更新说明」时多次尝试仍没有完成', { timeout: TASK_RUN_TIMEOUT_MS });
    await expect(page.getByTestId('step-a')).toContainText('完成');
    // Why the step's last attempt did not get it done, and that the finished step stays (D118).
    await expect(failure.getByTestId('last-failure')).toHaveText('AI 最后一次没有提交结果就停下了。');
    await expect(failure).toContainText('已完成的 1 个步骤会保留，重试从这一步继续。');

    await queueTurn(request, project, { title: '更新说明' }, [submitResult('已更新说明')]);
    await queueTurn(request, project, { title: '整体验证' }, [submitResult('全部通过')]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
    await failure.getByRole('button', { name: '带上说明重试…' }).click();
    const note = page.getByRole('dialog', { name: '带上说明重试' });
    await note.getByLabel('给 AI 的说明').fill('说明写在 README.md 里。');
    await note.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByTestId('result-card')).toContainText('检查全部通过', { timeout: TASK_RUN_TIMEOUT_MS });
  } finally {
    await patchSettings(request, { 'node.maxAttempts': 3 });
  }
});
