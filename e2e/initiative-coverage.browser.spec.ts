import { type InitiativeDetailDTO, type TaskDetailDTO, taskRequirementsSchema } from '@aw/shared';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import {
  createProject,
  GIT_HEAVY_SPECS_SLOW,
  git,
  passReview,
  patchSettings,
  queueBreakdownTurn,
  queueTurn,
  submitResult,
  TASK_RUN_TIMEOUT_MS,
} from './helpers.ts';

test.slow(GIT_HEAVY_SPECS_SLOW, '两阶段任务执行及交付');
test.afterEach(({ request }) => patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' }));

const point = '退款金额在订单和支付两端保持一致';
const unplanned = '历史退款数据迁移';

const coverageRow = async (page: Page): Promise<Locator> => {
  const coverage = page.getByTestId('initiative-understanding');
  await coverage.getByText('需求 2 点，1 点有对应工作包', { exact: true }).click();
  const row = coverage.locator('details').filter({ has: page.locator('summary').getByText(point, { exact: true }) });
  const demand = row.last();
  await demand.getByText(point, { exact: true }).click();
  return demand;
};

test('UX-11 从两阶段的共同需求直达验收输出和最终交付改动', async ({ page, request }, testInfo) => {
  await patchSettings(request, { 'ui.theme': 'codex', 'ui.mode': 'simple' });
  const project = await createProject(request, null);
  const packages = [
    { key: 'order', title: '订单金额测试', acceptance: '订单按分取整', output: 'order-rounding-proof' },
    { key: 'payment', title: '支付金额测试', acceptance: '支付保留订单金额', output: 'payment-rounding-proof' },
  ];
  await queueBreakdownTurn(request, project, [
    {
      type: 'callTool',
      name: 'submit_breakdown',
      args: {
        title: '退款金额一致性',
        summary: '先验证订单金额，再用它核对支付金额。',
        understanding: { scope: point, out_of_scope: [unplanned] },
        phases: [
          { title: '订单', goal: '订单退款按分取整' },
          { title: '支付', goal: '支付使用订单的退款金额' },
        ],
        items: packages.map((work, index) => ({
          key: work.key,
          title: work.title,
          phase: index + 1,
          workflow: 'unit_tests',
          requirement: work.acceptance,
          depends_on: index === 0 ? [] : ['order'],
          acceptance: [
            {
              key: 'amount',
              title: work.acceptance,
              expected: '输出金额核验凭据且退出码为 0',
              command: `node -e "console.log('${work.output}')"`,
            },
          ],
        })),
        coverage: [
          {
            point,
            items: ['order', 'payment'],
            links: packages.map((work) => ({ item: work.key, acceptance: ['amount'] })),
          },
          { point: unplanned, items: [] },
        ],
      },
    },
  ]);
  for (const work of packages) {
    await queueTurn(request, project, { title: '分析测试缺口' }, [submitResult(`检查${work.title}`)]);
    await queueTurn(request, project, { title: '编写测试' }, [
      { type: 'edit', file: `${work.key}.test.txt`, content: `${work.acceptance}\n` },
      submitResult(work.title),
    ]);
    await queueTurn(request, project, { agent: 'aw-reviewer' }, [passReview]);
    await queueTurn(request, project, { title: '核验验收清单' }, [submitResult('金额核验结束')]);
  }
  const created = await request.post(`${API_BASE}/initiatives`, {
    headers: AUTH,
    data: { projectId: project.id, requirement: point, review: true },
  });
  await expect(created).toBeOK();
  const initiative: InitiativeDetailDTO = await created.json();
  const planPath = `/initiatives/${initiative.id}`;
  await page.goto(planPath);
  await page.getByRole('button', { name: '确认并开始第 1 阶段' }).click({ timeout: TASK_RUN_TIMEOUT_MS });

  let demand = await coverageRow(page);
  await page.getByTestId('initiative-understanding').locator('summary').getByText(unplanned, { exact: true }).click();
  await expect(page.getByTestId('initiative-understanding').getByText('未安排工作包')).toBeVisible();

  const orderAcceptance = demand.getByRole('link', { name: '订单按分取整', exact: true });
  await expect(orderAcceptance).toBeVisible({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(demand.getByText('尚未开始任务', { exact: true })).toBeVisible();
  await orderAcceptance.click();
  await expect(page).toHaveURL(/\/tasks\/[^?]+\?requirement=/);
  await expect(page.getByTestId('requirements').getByText('order-rounding-proof', { exact: true })).toBeVisible({
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  await expect(page.getByTestId('requirements').locator('summary').filter({ hasText: '订单按分取整' })).toBeFocused();
  await page
    .getByTestId('requirements')
    .getByRole('link', { name: /查看核验步骤/ })
    .click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+\/nodes\/[^/]+/);
  await expect(page.getByRole('heading', { name: /核验验收清单/ })).toBeVisible();
  const taskPath = new URL(page.url()).pathname.split('/nodes/')[0];
  await page.goto(taskPath);
  await page.getByRole('button', { name: '合并到 main', exact: true }).click({ timeout: TASK_RUN_TIMEOUT_MS });
  await expect(page.getByTestId('delivery-outcome')).toContainText('已合并到 main', { timeout: TASK_RUN_TIMEOUT_MS });
  const firstTaskResponse = await request.get(`${API_BASE}${taskPath}`, { headers: AUTH });
  await expect(firstTaskResponse).toBeOK();
  const firstTask: TaskDetailDTO = await firstTaskResponse.json();
  const firstCommit = git(project.repoPath, 'rev-parse', 'main');
  const checklistResponse = await request.get(`${API_BASE}${taskPath}/requirements`, { headers: AUTH });
  await expect(checklistResponse).toBeOK();
  const checklist = taskRequirementsSchema.parse(await checklistResponse.json());
  const evaluatedCommit = checklist.items[0]?.latest?.commitSha;
  expect(evaluatedCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(evaluatedCommit).not.toBe(firstCommit);
  expect(checklist.commitSha).toBe(evaluatedCommit);
  expect(firstTask.lastDelivery?.commitSha).toBe(firstCommit);

  await page.goto(planPath);
  demand = await coverageRow(page);
  await expect(demand).not.toContainText('已过期');
  await expect(demand.getByText('order-rounding-proof', { exact: true })).toBeVisible();
  await demand.getByRole('link', { name: `本地交付提交 ${firstCommit.slice(0, 12)}`, exact: true }).click();
  await expect(page).toHaveURL(/delivery=true$/);
  const diff = page.getByRole('dialog', { name: '改动', exact: true });
  await expect(diff.getByText('order.test.txt', { exact: true }).first()).toBeVisible();
  await expect(diff).not.toContainText('payment.test.txt');
  await page.keyboard.press('Escape');
  await expect(diff).toBeHidden();
  await expect(page).not.toHaveURL(/delivery=true/);

  await page.goto(planPath);
  await page.getByRole('button', { name: '进入第 2 阶段', exact: true }).click();
  const nextPhase = page.getByRole('dialog', { name: '进入第 2 阶段？' });
  await nextPhase.getByRole('checkbox', { name: /先让 AI 按合入后的代码细化/ }).uncheck();
  await nextPhase.getByRole('button', { name: '进入第 2 阶段', exact: true }).click();
  demand = await coverageRow(page);
  await expect(demand.getByText('payment-rounding-proof', { exact: true })).toBeVisible({
    timeout: TASK_RUN_TIMEOUT_MS,
  });
  await expect(demand.getByText('order-rounding-proof', { exact: true })).toBeVisible();
  await expect(demand.getByRole('link', { name: `本地交付提交 ${firstCommit.slice(0, 12)}` })).toBeVisible();
  await page
    .getByTestId('initiative-understanding')
    .screenshot({ path: testInfo.outputPath('requirement-coverage-light.png') });
  await patchSettings(request, { 'ui.theme': 'default' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await page
    .getByTestId('initiative-understanding')
    .screenshot({ path: testInfo.outputPath('requirement-coverage-dark.png') });
});
