import { createServer } from 'node:http';
import {
  AttemptStatus,
  createTaskOp,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  functionalTestApproveRevisionOp,
  functionalTestReadOp,
  functionalTestRepairOp,
  functionalTestReportReadOp,
  functionalTestRerunOp,
  getTaskOp,
  MCP_SESSION_ARG,
  McpToolName,
  ServerEventType,
  startTaskOp,
  TaskStatus,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';

it('在授权的 HTTP 范围内执行，保留断言与修订，按本轮证据生成报告', async () => {
  const requests: string[] = [];
  let origin = '';
  let outsideOrigin = '';
  let outsideCalls = 0;
  const outside = createServer((_, response) => {
    outsideCalls++;
    response.end();
  });
  const app = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/redirect') {
      response.writeHead(302, { location: outsideOrigin });
      response.end();
      return;
    }
    response.writeHead(request.url === '/items' ? 201 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ done: false, id: 'item-1', token: 'fixture-secret' }));
  });
  await new Promise<void>((resolve) => outside.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test endpoint');
  origin = `http://127.0.0.1:${address.port}`;
  const other = outside.address();
  if (other === null || typeof other === 'string') throw new Error('Missing second test endpoint');
  outsideOrigin = `http://127.0.0.1:${other.port}`;
  let testApp: Awaited<ReturnType<typeof createTestApp>> | undefined;
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    const t = await createTestApp();
    testApp = t;
    const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
    client = mcp;
    const { project } = await addProject(t);
    const creation = await t.call(createTaskOp, {
      projectId: project.id,
      requirement: '检查待办 API',
      workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
      functionalTest: { target: origin, writes: [{ method: 'POST', path: '/items' }], caseAttachmentIds: [] },
      checkpoints: { confirm_plan: false, accept_each_node: false, ask_on_uncertainty: false },
      start: false,
    });
    expect(creation.status).toBe(201);
    const taskId = creation.body.id;
    const next = (key: string) => {
      t.fake.enqueue(script().hang());
      return waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt, nodeId, taskId: task }) =>
          task === taskId &&
          attempt.status === AttemptStatus.Running &&
          t.app.services.tasks.detail(taskId).nodes.some((node) => node.id === nodeId && node.key === key),
      );
    };
    const call = async (stage: ReturnType<typeof next>, name: McpToolName, args: Record<string, unknown> = {}) => {
      const { attempt } = await stage;
      const session = t.app.services.attempts.get(attempt.id).opencodeSessionId;
      return callTool(mcp, name, { ...args, [MCP_SESSION_ARG]: session });
    };
    const must = async (stage: ReturnType<typeof next>, name: McpToolName, args?: Record<string, unknown>) => {
      const { isError, body } = await call(stage, name, args);
      expect(isError, JSON.stringify(body)).toBe(false);
      return body;
    };
    const author = next(FUNCTIONAL_TEST_NODE.Author);
    await t.call(startTaskOp, { id: taskId });
    expect((await call(author, McpToolName.TestEnvironmentPrepare)).body.code).toBe(ErrorCode.McpToolNotAllowed);
    const definition = {
      title: '创建并读取待办',
      requirement: '保存后可用新 ID 读取',
      preconditions: [],
      data: '',
      cleanup: [],
      steps: [
        {
          kind: 'http',
          title: '创建',
          method: 'POST',
          path: '/items',
          body: { title: 'Demo' },
          assertions: [{ field: 'status', equals: 200, basis: '用户需求' }],
        },
        {
          kind: 'http',
          title: '读取',
          method: 'GET',
          path: '/items/{{0.body.id}}',
          assertions: [
            { field: 'body.done', equals: false, basis: '用户需求' },
            { field: 'body.token', equals: 'fixture-secret', basis: '脱敏样本' },
          ],
        },
      ],
    };
    const first = await must(author, McpToolName.TestCaseSave, definition);
    const failedCase = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      title: '正常接口缺陷',
      steps: [
        {
          kind: 'http',
          title: '验证读取标志',
          method: 'GET',
          path: '/items/item-1',
          assertions: [{ field: 'body.done', equals: true, basis: '已完成事项的验收条件' }],
        },
      ],
    });
    const blockedCase = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      title: '阻止超出授权范围的写入',
      steps: [
        {
          kind: 'http',
          title: '向未授权 URL 写入',
          method: 'POST',
          path: '/private',
          assertions: [{ field: 'status', equals: 200, basis: '权限范围验证' }],
        },
      ],
    });
    const redirected = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      title: '重定向越界',
      steps: [
        {
          kind: 'http',
          title: '读取越界路径',
          method: 'GET',
          path: '/redirect',
          assertions: [{ field: 'status', equals: 200, basis: '权限范围验证' }],
        },
      ],
    });
    const environment = next(FUNCTIONAL_TEST_NODE.Environment);
    await must(author, McpToolName.SubmitResult, { summary: '已保存四条用例' });
    const run = await must(environment, McpToolName.TestEnvironmentPrepare);
    const execute = next(FUNCTIONAL_TEST_NODE.Execute);
    await must(environment, McpToolName.SubmitResult, { summary: '测试环境可达' });
    const params = { runId: run.id, caseId: first.id, version: 1, executionId: 'v1' };
    expect((await must(execute, McpToolName.TestCaseRun, params)).status).toBe('failed');
    expect((await must(execute, McpToolName.TestCaseRun, params)).id).toBe('v1');
    expect(requests.filter((request) => request === 'POST /items')).toHaveLength(1);
    const revised = {
      ...definition,
      steps: definition.steps.map((step, index) =>
        index === 0
          ? { ...step, assertions: [{ field: 'status', equals: 201, basis: '用户已确认的新状态预期' }] }
          : step,
      ),
    };
    const proposal = await must(execute, McpToolName.TestCaseRevise, {
      caseId: first.id,
      version: 1,
      executionId: 'v1',
      reason: '成功状态码待确认',
      basis: '本次实测',
      definition: revised,
    });
    expect(proposal.pending).toBe(true);
    const before = (await t.call(functionalTestReadOp, { taskId })).body;
    expect(before.cases.filter(({ id }) => id === first.id)).toHaveLength(1);
    const approval = await t.call(functionalTestApproveRevisionOp, { taskId, proposal: Number(proposal.proposal) });
    expect(approval.body.version).toBe(2);
    expect((await must(execute, McpToolName.TestCaseRun, { ...params, version: 2, executionId: 'v2' })).status).toBe(
      'passed',
    );
    expect(
      (await must(execute, McpToolName.TestCaseRun, { ...params, caseId: failedCase.id, executionId: 'defect' }))
        .status,
    ).toBe('failed');
    expect(
      (await must(execute, McpToolName.TestCaseRun, { ...params, caseId: blockedCase.id, executionId: 'scope' }))
        .status,
    ).toBe('blocked');
    expect(
      (await must(execute, McpToolName.TestCaseRun, { ...params, caseId: redirected.id, executionId: 'redirect' }))
        .status,
    ).toBe('blocked');
    expect(outsideCalls).toBe(0);
    expect(requests).not.toContain('POST /private');
    expect(requests).toContain('GET /items/item-1');
    const report = next(FUNCTIONAL_TEST_NODE.Report);
    await must(execute, McpToolName.SubmitResult, { summary: '执行完成' });
    const input = { runId: run.id, executionIds: ['v1', 'v2', 'defect', 'scope', 'redirect'] };
    expect((await call(report, McpToolName.TestReportSubmit, { ...input, executionIds: ['v2'] })).body.code).toBe(
      ErrorCode.ValidationFailed,
    );
    const written = await must(report, McpToolName.TestReportSubmit, input);
    expect(written.counts).toEqual({ passed: 1, failed: 1, blocked: 2, not_run: 0 });
    expect(written.markdown).toContain('v1 实测 · 失败');
    expect(written.markdown).toContain('v2 实测 · 通过');
    expect(written.markdown).not.toContain('fixture-secret');
    const published = await t.call(functionalTestReportReadOp, { taskId });
    expect(published.body.markdown).toBe(written.markdown);
    const review = taskReaches(t, TaskStatus.Review);
    await must(report, McpToolName.SubmitResult, { summary: '已生成报告' });
    await review;
    const selection = { taskId, executionIds: ['defect'] };
    t.fake.enqueue(script().hang());
    const repair = await t.call(functionalTestRepairOp, selection);
    expect(repair.status).toBe(200);
    expect((await t.call(functionalTestRepairOp, selection)).body).toEqual(repair.body);
    const original = (await t.call(getTaskOp, { id: taskId })).body;
    expect(original.testLinks).toContainEqual({
      sourceId: taskId,
      taskId: repair.body.taskId,
      kind: 'repair',
      executionIds: ['defect'],
    });
    expect((await t.call(getTaskOp, { id: repair.body.taskId })).body.testLinks).toEqual(original.testLinks);
    const commit = original.git.baseCommit;
    if (commit === null) throw new Error('Expected original git baseline');
    t.fake.enqueue(script().hang());
    const rerunReady = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (event) =>
        event.id !== taskId &&
        event.workflow.key === FUNCTIONAL_TEST_WORKFLOW_KEY &&
        event.status === TaskStatus.Running,
    );
    const rerun = await t.call(functionalTestRerunOp, { ...selection, ref: commit });
    expect(rerun.status).toBe(200);
    await rerunReady;
    const followup = (await t.call(getTaskOp, { id: rerun.body.taskId })).body;
    expect(followup.git.baseCommit).toBe(commit);
    expect(followup.nodes.map(({ key }) => key)).toEqual([
      FUNCTIONAL_TEST_NODE.Environment,
      FUNCTIONAL_TEST_NODE.Execute,
      FUNCTIONAL_TEST_NODE.Report,
    ]);
    expect((await t.call(functionalTestReadOp, { taskId: followup.id })).body.cases).toMatchObject([
      { id: failedCase.id, version: 1 },
    ]);
    expect(followup.testLinks).toContainEqual({
      sourceId: taskId,
      taskId: followup.id,
      kind: 'rerun',
      executionIds: ['defect'],
    });
    expect((await fetch(origin)).status).toBe(200);
  } finally {
    await client?.close();
    await testApp?.close();
    app.close();
    outside.close();
  }
});
