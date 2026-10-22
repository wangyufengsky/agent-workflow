import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  type FakeStep,
  passReview,
  patchSettings,
  queueResearchTurn,
  queueTurn,
  startTask,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

// J22 (07 §5, 25): the conversation stream of a step and of a knowledge question, played by FakeOpencode.

const THOUGHT = 'The export drops the last row.\nThe loop bound in buildRows() looks off by one; check it first.';
/** An unbroken path longer than the instructions column (25 §2.2). */
const LONG_PATH = `apps/order-service/src/main/java/com/example/orders/export/${'VeryLongExporterName'.repeat(6)}.java`;
const READS = 16;
const reads: FakeStep[] = Array.from({ length: READS }, (_, i) => ({
  type: 'tool',
  tool: 'read',
  input: { filePath: `src/module-${i}.ts` },
}));

test.beforeEach(({ request }) => patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'simple' }));

test('J22 步骤的会话流：思考、固定高度、上翻后回到最新、结束后收起成一行、专业步骤页', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueTurn(request, project, { agent: 'aw-planner' }, [
    {
      type: 'callTool',
      name: 'submit_plan',
      args: {
        summary: '修复导出，然后整体验证。',
        nodes: [
          { key: 'impl', title: '修复导出', role: 'developer', instructions: `修复 ${LONG_PATH} 中的循环边界。` },
          { key: 'final_verify', title: '整体验证', role: 'tester', instructions: 'Verify', depends_on: ['impl'] },
        ],
      },
    },
  ]);
  await queueTurn(request, project, { title: '修复导出' }, [
    { type: 'think', text: THOUGHT },
    { type: 'text', text: '先看导出逻辑。' },
    ...reads,
    { type: 'permission', permission: 'bash', patterns: ['pnpm test'] },
    submitResult('修好了循环边界'),
  ]);
  await queueTurn(request, project, { title: '整体验证' }, [submitResult('检查通过')]);
  await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);

  await startTask(page, project, /新功能开发/, '导出的报表缺少最后一行');
  const permission = page.getByTestId('inbox-permission');
  await expect(permission).toContainText('pnpm test', { timeout: TASK_RUN_TIMEOUT_MS });
  const taskId = new URL(page.url()).pathname.split('/')[2];
  const task = await (await request.get(`${API_BASE}/tasks/${taskId}`, { headers: AUTH })).json();
  const nodeId: string = task.nodes.find((n: { key: string }) => n.key === 'impl').id;

  // Running: the stream is open, shows the thinking folded and the permission it waits for.
  await page.goto(`/tasks/${taskId}?node=${nodeId}&open=true`);
  const stream = page.getByRole('dialog').getByTestId('conversation-stream');
  await expect(stream.getByRole('button', { name: /执行过程/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(stream).toContainText('等待你允许：bash pnpm test');
  await expect(stream.getByRole('link', { name: '去处理' })).toBeVisible();

  // A box of fixed height: the content scrolls inside it and the stream follows the bottom.
  const scroll = stream.getByTestId('stream-scroll');
  const metrics = () =>
    scroll.evaluate((el) => ({
      height: el.scrollHeight,
      client: el.clientHeight,
      bottom: el.scrollTop + el.clientHeight,
    }));
  const at = await metrics();
  expect(at.height).toBeGreaterThan(at.client);
  expect(at.bottom).toBeGreaterThanOrEqual(at.height - 1);
  await scroll.evaluate((el) => el.scrollTo({ top: 0 }));
  const latest = stream.getByRole('button', { name: /回到最新/ });
  await latest.click();
  await expect(latest).toBeHidden();
  await expect.poll(async () => (await metrics()).bottom).toBeGreaterThanOrEqual(at.height - 1);
  const thinking = stream.getByTestId('stream-thinking');
  await expect(thinking).toContainText('思考了');
  await expect(thinking).toContainText('The export drops the last row.');
  await thinking.getByRole('button').click();
  await expect(thinking).toContainText('check it first.');

  // Ended: the process folds to one line; open, the reads in a row fold into a group.
  await page.keyboard.press('Escape');
  await permission.getByRole('button', { name: '允许一次' }).click();
  await expect(page.getByTestId('result-card')).toContainText('已完成 2 个步骤', { timeout: TASK_RUN_TIMEOUT_MS });
  await page.goto(`/tasks/${taskId}/nodes/${nodeId}`);
  await page.getByRole('tab', { name: '过程' }).click();
  const ended = page.getByTestId('conversation-stream');
  const toggle = ended.getByRole('button', { name: /执行过程/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(ended).toContainText(`已提交结果 · 思考 1 段 · ${READS + 1} 个动作`);
  await toggle.click();
  await expect(ended.getByTestId('stream-group')).toContainText(`查看 ${READS} 个文件`);
  await expect(ended.getByTestId('stream-thinking')).toContainText('思考了');

  // Pro step page: every attempt in its own stream, ended ones folded; long instructions stay in their column.
  await patchSettings(request, { 'ui.mode': 'pro' });
  await page.reload();
  const attempts = page.getByTestId('conversation-stream');
  await expect(attempts.first().getByRole('button', { name: /执行 #1/ })).toHaveAttribute('aria-expanded', 'false');
  const instructions = page.locator('section').filter({ has: page.getByRole('heading', { name: '指令' }) });
  await expect(instructions).toContainText('VeryLongExporterName');
  expect(await instructions.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await attempts
    .first()
    .getByRole('button', { name: /执行 #1/ })
    .click();
  await expect(attempts.first()).toContainText('发给 AI 的消息');
});

test('J22 知识问答的研究过程：正在思考，停止后保留会话流', async ({ page, request }) => {
  const project = await createProject(request, null);
  await queueResearchTurn(request, project, [
    { type: 'tool', tool: 'grep', input: { pattern: 'refund' } },
    { type: 'think', text: 'The refund rounding lives somewhere in src.\nLook for Math.round next.' },
    { type: 'hang' },
  ]);
  await page.goto(`/knowledge?projectId=${project.id}`);
  await page.getByLabel('向项目提问').fill('退款金额在哪里四舍五入？');
  await page.getByLabel('向项目提问').press('Enter');

  const card = page.getByTestId('research-process');
  await expect(card.getByRole('button', { name: /研究过程/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByTestId('stream-thinking')).toContainText('正在思考');
  await expect(card.getByTestId('stream-thinking')).toContainText('Look for Math.round next.');
  await expect(card).toContainText('检索资料 检索 1 次');

  // Stopped: the card folds like an answered one; open, the stream is still there.
  await page.getByRole('button', { name: '停止' }).click();
  await expect(page.getByTestId('knowledge-turn')).toContainText('已停止');
  const toggle = card.getByRole('button', { name: /研究过程/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(card.getByTestId('stream-thinking')).toContainText('思考了');
});
