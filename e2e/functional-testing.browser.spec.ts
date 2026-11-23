import { readFile } from 'node:fs/promises';
import { FUNCTIONAL_TEST_WORKFLOW_KEY, type FunctionalTestSnapshot, TaskStatus, taskDetailSchema } from '@aw/shared';
import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { appTool, createProject, queueAssistantTurn } from './helpers.ts';

test('发起功能测试时选择已上传的用例附件并确认范围', async ({ page, request }) => {
  const project = await createProject(request, null);
  await page.goto(`/?projectId=${project.id}&workflow=${FUNCTIONAL_TEST_WORKFLOW_KEY}`);
  await page.getByRole('textbox', { name: '需求', exact: true }).fill('验证订单读取');
  const scope = page.getByRole('group', { name: '功能测试范围' });
  await scope.getByRole('textbox', { name: /测试地址/ }).fill('/orders');
  await scope.getByRole('textbox', { name: /允许写入的接口/ }).fill('POST /orders');
  const approval = scope.getByRole('checkbox', { name: /授权/ });
  await approval.check();
  const start = page.getByRole('button', { name: /^开始/ });
  await expect(start).toBeEnabled();

  await page.locator('input[type=file]').setInputFiles({
    name: 'cases.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('## ORD-1\n- GET /orders\n- 预期：200'),
  });
  await scope.getByRole('checkbox', { name: 'cases.md' }).check();
  await expect(approval).not.toBeChecked();
  await expect(start).toBeDisabled();
  await approval.check();
  await scope.getByRole('combobox', { name: '发现功能失败时' }).selectOption('repair');
  await expect(approval).not.toBeChecked();
  await expect(start).toBeDisabled();
  await approval.check();

  await page.route('**/api/v1/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    // 只观察建单边界，保存草稿避免启动本用例不需要的模型回合。
    const requestBody: unknown = route.request().postDataJSON();
    expect(requestBody).toMatchObject({
      functionalTest: {
        target: '/orders',
        writes: [{ method: 'POST', path: '/orders' }],
        caseAttachmentIds: [expect.any(String)],
        onFailure: 'repair',
      },
    });
    if (requestBody === null || typeof requestBody !== 'object') throw new Error('Expected task creation payload');
    const response = await route.fetch({ postData: { ...requestBody, start: false } });
    await route.fulfill({ response });
  });
  await start.click();
  await expect(page.getByRole('tab', { name: '测试现场' })).toBeVisible();
  await expect(page.getByRole('button', { name: '解析上传用例', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('回看用例时行为与终端同步，迟到响应仍归属原用例，空闲后恢复跟随', async ({ page, request }) => {
  const project = await createProject(request, null);
  const workflowsResponse = await request.get(`${API_BASE}/workflows`, { headers: AUTH });
  await expect(workflowsResponse).toBeOK();
  const workflows: { items: { id: string; key: string }[] } = await workflowsResponse.json();
  const workflow = workflows.items.find(({ key }) => key === FUNCTIONAL_TEST_WORKFLOW_KEY);
  if (workflow === undefined) throw new Error('Functional testing workflow unavailable');
  const created = await request.post(`${API_BASE}/tasks`, {
    headers: AUTH,
    data: {
      projectId: project.id,
      workflowId: workflow.id,
      requirement: '验证订单接口',
      functionalTest: { target: '/orders', writes: [], caseAttachmentIds: [] },
      start: false,
    },
  });
  await expect(created).toBeOK();
  const task = taskDetailSchema.parse(await created.json());
  const now = Date.now();
  const snapshot: FunctionalTestSnapshot = {
    cases: [1, 2, 3].map((number) => ({
      id: `case-${number}`,
      number: `FT-0${number}`,
      version: 1,
      title: `用例 ${number}`,
      requirement: '检查订单响应',
      preconditions: [],
      data: '',
      steps: [],
      cleanup: [],
    })),
    runs: [
      {
        id: 'run-1',
        createdAt: now,
        environment: {
          id: 'env-1',
          target: 'http://localhost/orders',
          baseline: null,
          verified: false,
          ready: true,
          reason: null,
          logTail: '',
        },
      },
    ],
    executions: [
      { id: 'exec-1', runId: 'run-1', caseId: 'case-1', version: 1, status: 'passed', startedAt: now, finishedAt: now },
      {
        id: 'exec-2',
        runId: 'run-1',
        caseId: 'case-2',
        version: 1,
        status: 'running',
        startedAt: now,
        finishedAt: null,
      },
    ],
    events: [
      {
        seq: 1,
        runId: 'run-1',
        caseId: 'case-1',
        executionId: 'exec-1',
        step: 0,
        at: now,
        kind: 'action',
        message: 'GET /orders/first',
        detail: {},
      },
      {
        seq: 2,
        runId: 'run-1',
        caseId: 'case-1',
        executionId: 'exec-1',
        step: 0,
        at: now,
        kind: 'result',
        message: '首个响应',
        detail: { status: 200 },
      },
      {
        seq: 3,
        runId: 'run-1',
        caseId: 'case-2',
        executionId: 'exec-2',
        step: 0,
        at: now,
        kind: 'action',
        message: 'GET /orders/second',
        detail: {},
      },
    ],
    reports: [],
    nextAfter: 3,
  };
  const testLinks: NonNullable<typeof task.testLinks> = [];
  await page.route(`**/api/v1/tasks/${task.id}`, (route) =>
    route.fulfill({ json: { ...task, status: TaskStatus.Running, testLinks } }),
  );
  const snapshotPath = `/api/v1/tasks/${task.id}/functional-test`;
  await page.route(
    (url) => url.pathname === snapshotPath,
    (route) => {
      const after = Number(new URL(route.request().url()).searchParams.get('after') ?? 0);
      return route.fulfill({ json: { ...snapshot, events: snapshot.events.filter(({ seq }) => seq > after) } });
    },
  );
  await page.clock.install();
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: '执行测试', exact: true }).click();
  const actions = page.getByRole('complementary', { name: 'AI 活动' });
  const terminal = page.getByRole('region', { name: '结果终端' });
  const cases = page.getByRole('group', { name: '测试用例' });
  const second = cases.getByRole('button', { name: /FT-02/ });
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(actions).toContainText('GET /orders/second · 等待响应');
  await cases.hover();
  await page.mouse.wheel(0, -48);
  const first = cases.getByRole('button', { name: /FT-01/ });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(actions).toContainText('GET /orders/first');
  await expect(terminal).toContainText('首个响应');
  await expect(page.getByText('正在执行 · FT-02', { exact: true })).toBeVisible();

  snapshot.events.push({
    seq: 4,
    runId: 'run-1',
    caseId: 'case-2',
    executionId: 'exec-2',
    step: 0,
    at: now,
    kind: 'result',
    message: '迟到的第二个响应',
    detail: { status: 201, elapsedMs: 72 },
  });
  snapshot.events.push({
    seq: 5,
    runId: 'run-1',
    caseId: 'case-2',
    executionId: 'exec-2',
    step: 0,
    at: now,
    kind: 'assertion',
    message: 'HTTP 断言',
    detail: { field: 'body.fee', expected: 10, actual: 9, passed: false },
  });
  snapshot.nextAfter = 5;
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === snapshotPath);
  await page.clock.runFor(1000);
  await refreshed;
  await expect(actions).not.toContainText('GET /orders/second');
  await expect(terminal).not.toContainText('迟到的第二个响应');
  await page.clock.runFor(5000);
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(actions).toContainText('GET /orders/second · 201 · 72 毫秒');
  await expect(terminal).toContainText('迟到的第二个响应');

  const assertion = page.getByRole('table').getByRole('row', { name: /body.fee/ });
  await expect(assertion.getByRole('cell')).toHaveText(['10', '9']);
  await expect(terminal).toContainText('FAIL · body.fee · 预期 10，实际 9');
  await actions.getByText('GET /orders/second · 201 · 72 毫秒', { exact: true }).click();
  const responseAction = actions.getByRole('group').filter({ hasText: 'GET /orders/second · 201 · 72 毫秒' });
  await expect(responseAction.getByText(/"status": 201/)).toBeVisible();
  await actions.getByRole('button', { name: '完整详情' }).click();
  const detail = page.getByRole('dialog', { name: 'AI 活动 · FT-02' });
  await expect(detail.getByText(/"status": 201/).first()).toBeVisible();
  await detail.getByRole('button', { name: '关闭' }).click();
  await expect(detail).toBeHidden();
  await second.focus();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '回到实时' }).click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');

  const body = '## 订单报告\n\nFT-02：响应不符合用例预期。';
  snapshot.reports.push({
    runId: 'run-1',
    version: 1,
    markdown: body,
    createdAt: now,
    counts: { passed: 0, failed: 1, blocked: 0, not_run: 2 },
    items: [
      { caseId: 'case-2', number: 'FT-02', title: '用例 2', version: 1, status: 'failed', executionId: 'exec-2' },
    ],
  });
  const published = page.waitForResponse((response) => new URL(response.url()).pathname === snapshotPath);
  await page.clock.runFor(1000);
  await published;
  await page.getByRole('button', { name: '测试报告', exact: true }).click();
  const report = page.getByRole('region', { name: '测试报告' });
  await expect(report.getByRole('heading', { name: '订单报告' })).toBeVisible();
  const failure = report.getByRole('checkbox', { name: '将 FT-02 纳入修复' });
  const repair = report.getByRole('button', { name: '建立修复任务' });
  await expect(failure).toBeChecked();
  await failure.uncheck();
  await expect(repair).toBeDisabled();
  await failure.focus();
  await failure.press('Space');
  await expect(repair).toBeEnabled();
  await page.route(`**${snapshotPath}/repair`, (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ executionIds: ['exec-2'] });
    testLinks.push({ sourceId: task.id, taskId: 'repair-task', kind: 'repair', executionIds: ['exec-2'] });
    return route.fulfill({ json: { taskId: 'repair-task' } });
  });
  await repair.click();
  await expect(report.getByRole('link', { name: '打开关联修复任务' })).toBeVisible();
  await report.getByRole('button', { name: '用修复版本复测' }).click();
  const rerunDialog = page.getByRole('dialog', { name: '用修复版本复测' });
  const rerun = rerunDialog.getByRole('button', { name: '开始复测' });
  await expect(rerun).toBeDisabled();
  await rerunDialog.getByRole('textbox', { name: '修复提交或分支' }).fill('fix/orders');
  await page.route(`**${snapshotPath}/rerun`, (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ executionIds: ['exec-2'], ref: 'fix/orders' });
    testLinks.push({ sourceId: task.id, taskId: 'rerun-task', kind: 'rerun', executionIds: ['exec-2'] });
    return route.fulfill({ json: { taskId: 'rerun-task' } });
  });
  await rerun.click();
  await expect(rerunDialog).not.toBeVisible();
  await expect(report.getByRole('link', { name: '打开复测任务' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await report.getByRole('button', { name: '导出 Markdown' }).click();
  const download = await downloading;
  expect(await readFile(await download.path(), 'utf8')).toBe(body);
  await report.getByRole('button', { name: '查看实测证据' }).click();
  await expect(terminal).toContainText('迟到的第二个响应');
});

test('助手确认卡展示测试地址、写入范围与失败后续操作', async ({ page, request }) => {
  const project = await createProject(request, null);
  const response = await request.get(`${API_BASE}/workflows`, { headers: AUTH });
  await expect(response).toBeOK();
  const workflows: { items: { id: string; key: string }[] } = await response.json();
  const workflow = workflows.items.find(({ key }) => key === FUNCTIONAL_TEST_WORKFLOW_KEY);
  if (workflow === undefined) throw new Error('Functional testing workflow unavailable');
  await queueAssistantTurn(request, [
    appTool('tasks_create', {
      projectId: project.id,
      workflowId: workflow.id,
      requirement: '检查订单保存',
      start: false,
      functionalTest: {
        target: '/orders',
        writes: [{ method: 'POST', path: '/api/orders' }],
        caseAttachmentIds: [],
        onFailure: 'repair_and_retest',
      },
    }),
    { type: 'text', text: '请确认测试范围。' },
  ]);
  await queueAssistantTurn(request, [{ type: 'text', text: '已创建测试草稿。' }]);
  await page.goto(`/?projectId=${project.id}`);
  const input = page.getByRole('textbox', { name: '告诉助手，或开始任务' });
  await input.fill('检查订单保存。发现问题时修复，修复后复测。');
  await input.press('ControlOrMeta+Enter');
  const card = page.getByTestId('confirmation-card');
  await expect(card.getByText('功能测试范围')).toBeVisible();
  await expect(card.getByRole('button', { name: /总是允许/ })).toHaveCount(0);
  await expect(card.getByText('/orders', { exact: true })).toBeVisible();
  await expect(card.getByText('POST /api/orders', { exact: true })).toBeVisible();
  await expect(card.getByText('创建并运行修复任务，有可测试的修复提交后复测', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '确认', exact: true }).click();
  await expect(card).toContainText('已执行');
  await expect(page.getByTestId('entity-card')).toContainText('检查订单保存');
});
