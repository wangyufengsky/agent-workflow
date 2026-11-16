import { OPENCODE_AGENT_NAME, SessionAgent, taskDetailSchema } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  passReview,
  patchSettings,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test.afterEach(({ request }) => patchSettings(request, { 'ui.mode': 'simple', 'ui.theme': 'codex' }));

test('工作流节点可查看交接事实和只读子代理的过程', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await patchSettings(request, { 'ui.mode': 'pro', 'ui.theme': 'codex' });
  const project = await createProject(request, null);

  const delegated = await request.post(`${API_BASE}/dev/fake-opencode/scripts`, {
    headers: AUTH,
    data: {
      match: { agent: OPENCODE_AGENT_NAME[SessionAgent.Delegate] },
      steps: [
        { type: 'callTool', name: 'inspect_delegation', args: { action: 'read', path: 'package.json' } },
        { type: 'callTool', name: 'submit_delegation', args: { summary: 'package.json:1 定义了测试命令。' } },
      ],
    },
  });
  await expect(delegated).toBeOK();
  await queueTurn(request, project, { title: '定位根因' }, [
    { type: 'callTool', name: 'delegate_readonly', args: { questions: ['确认仓库的测试入口'] } },
    {
      type: 'callTool',
      name: 'submit_result',
      args: {
        summary: '定位到测试入口',
        handoff: {
          facts: [{ text: '仓库定义了测试命令', evidence: 'package.json:1' }],
          decisions: ['沿用现有测试入口'],
          openQuestions: ['需要覆盖空名称'],
        },
      },
    },
  ]);
  await queueTurn(request, project, { title: '修复' }, [
    { type: 'callTool', name: 'get_task_context', args: {} },
    { type: 'edit', file: 'name.ts', content: 'export const named = (name: string) => name.trim();\n' },
    submitResult('实现了输入清理'),
  ]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, '修 Bug', '清理名称两端的空白');
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 2 * TASK_RUN_TIMEOUT_MS });
  const taskPath = new URL(page.url()).pathname;
  const response = await request.get(`${API_BASE}${taskPath}`, { headers: AUTH });
  await expect(response).toBeOK();
  const task = taskDetailSchema.parse(await response.json());
  const locate = task.nodes.find((node) => node.key === 'locate');
  if (locate === undefined) throw new Error('任务缺少定位步骤');

  await page.goto(`${taskPath}/nodes/${locate.id}`);
  const step = page.getByTestId('node-page');
  await expect(step.getByRole('button', { name: /只读委派 #\d+/ })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('workflow-delegation-light.png') });
  await step.getByRole('tab', { name: '产出', exact: true }).click();
  await expect(step.getByText('交接给下游', { exact: true })).toBeVisible();
  await expect(step.getByText('package.json:1', { exact: true })).toBeVisible();
  await expect(step.getByText('沿用现有测试入口', { exact: true })).toBeVisible();
  await expect(step.getByText('需要覆盖空名称', { exact: true })).toBeVisible();
  await patchSettings(request, { 'ui.theme': 'default' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('workflow-handoff-dark.png') });
});
