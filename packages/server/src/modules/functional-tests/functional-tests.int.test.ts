import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ATTACHMENT_NAME_HEADER,
  AttemptStatus,
  attachmentSchema,
  createTaskOp,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  functionalTestApproveRevisionOp,
  functionalTestReadOp,
  functionalTestRepairOp,
  functionalTestReportReadOp,
  functionalTestRerunOp,
  functionalTestRunSchema,
  getTaskOp,
  MCP_SESSION_ARG,
  McpToolName,
  ServerEventType,
  startTaskOp,
  TaskStatus,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createFakeOpencode, script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject, taskReaches, workflowId } from '../../../test/helpers/tasks.ts';

it('在授权的 HTTP 范围内执行，保留断言与修订，按本轮证据生成报告', async () => {
  const requests: string[] = [];
  const data = new Set<string>();
  let origin = '';
  let outsideOrigin = '';
  let outsideCalls = 0;
  const outside = createServer((_, response) => {
    outsideCalls++;
    response.end();
  });
  const app = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === '/cleanup-fixture' && request.method === 'POST') {
      data.add('item-2');
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'item-2' }));
      return;
    }
    if (request.url === '/reset/item-2') {
      request.socket.destroy();
      return;
    }
    if (request.url === '/cleanup-fixture/item-2' && request.method === 'DELETE') {
      response.writeHead(data.delete('item-2') ? 204 : 404).end();
      return;
    }
    if (request.url === '/write-redirect') {
      data.add('item-3');
      response.writeHead(307, { location: '/write-destination' }).end();
      return;
    }
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
      functionalTest: {
        target: origin,
        writes: [
          { method: 'POST', path: '/items' },
          { method: 'POST', path: '/cleanup-fixture' },
          { method: 'DELETE', path: '/cleanup-fixture/item-2' },
          { method: 'POST', path: '/write-redirect' },
          { method: 'POST', path: '/write-destination' },
        ],
        caseAttachmentIds: [],
        onFailure: 'repair',
      },
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
    expect((await call(author, McpToolName.TestIdeConfigurations)).body.code).toBe(ErrorCode.McpToolNotAllowed);
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
    const probe = { key: 'GET', path: '/health', expectedStatus: 200 };
    const failedCase = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      requires: [probe.key],
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
    const cleanup = [
      {
        kind: 'http',
        title: '清理本轮数据',
        method: 'DELETE',
        path: '/cleanup-fixture/{{0.body.id}}',
        assertions: [{ field: 'status', equals: 204, basis: '夹具契约' }],
      },
    ];
    const reset = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      title: '读取断开时清理已确认创建的数据',
      steps: [
        {
          kind: 'http',
          title: '创建本轮数据',
          method: 'POST',
          path: '/cleanup-fixture',
          assertions: [{ field: 'status', equals: 201, basis: '夹具契约' }],
        },
        {
          kind: 'http',
          title: '读取断开的接口',
          method: 'GET',
          path: '/reset/{{0.body.id}}',
          assertions: [{ field: 'status', equals: 200, basis: '夹具契约' }],
        },
      ],
      cleanup,
    });
    const redirectedWrite = await must(author, McpToolName.TestCaseSave, {
      ...definition,
      title: '写请求收到重定向时暂停',
      steps: [
        {
          kind: 'http',
          title: '创建后返回重定向',
          method: 'POST',
          path: '/write-redirect',
          assertions: [{ field: 'status', equals: 201, basis: '夹具契约' }],
        },
      ],
      cleanup: [{ ...cleanup[0], path: '/cleanup-fixture/item-2' }],
    });
    const environment = next(FUNCTIONAL_TEST_NODE.Environment);
    await must(author, McpToolName.SubmitResult, { summary: '已保存用例' });
    expect((await call(environment, McpToolName.TestIdeConfigurations)).body.code).toBe(ErrorCode.McpToolNotAllowed);
    const refused = await call(environment, McpToolName.TestEnvironmentPrepare, {
      launch: { directory: '.', source: 'package.json', script: 'dev', readyPath: '/' },
    });
    expect(refused.body).toMatchObject({ code: ErrorCode.ValidationFailed });
    expect((await t.call(functionalTestReadOp, { taskId })).body.runs).toEqual([]);
    const run = await must(environment, McpToolName.TestEnvironmentPrepare, { checks: [probe] });
    expect(run.environment).toMatchObject({ verified: false, readyStatus: 200 });
    expect(run.environment).not.toHaveProperty('launch');
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
    const verifyReset = { ...params, caseId: reset.id, executionId: 'reset' };
    expect((await must(execute, McpToolName.TestCaseRun, verifyReset)).status).toBe('blocked');
    expect(data.has('item-2')).toBe(false);
    const write = { ...params, caseId: redirectedWrite.id, executionId: 'redirect-write' };
    expect((await must(execute, McpToolName.TestCaseRun, write)).status).toBe('blocked');
    expect((await must(execute, McpToolName.TestCaseRun, write)).id).toBe('redirect-write');
    expect((await call(execute, McpToolName.TestCaseRun, { ...write, executionId: 'redirect-retry' })).body.code).toBe(
      ErrorCode.StateTransitionInvalid,
    );
    expect(data.has('item-3')).toBe(true);
    expect(requests.filter((request) => request === 'POST /write-redirect')).toHaveLength(1);
    expect(requests).not.toContain('POST /write-destination');
    expect(requests.filter((request) => request === 'DELETE /cleanup-fixture/item-2')).toHaveLength(1);
    const evidence = (await t.call(functionalTestReadOp, { taskId })).body.events;
    expect(evidence).toContainEqual(
      expect.objectContaining({ executionId: 'reset', kind: 'result', step: 1, detail: { status: 'blocked' } }),
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({ executionId: 'reset', kind: 'cleanup', step: 2, detail: { status: 'passed' } }),
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({
        executionId: 'redirect-write',
        kind: 'result',
        detail: { status: 'blocked', unknownWrite: true },
      }),
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({ executionId: 'redirect-write', kind: 'cleanup', detail: { status: 'not_run' } }),
    );
    expect(outsideCalls).toBe(0);
    expect(requests).not.toContain('POST /private');
    expect(requests).toContain('GET /items/item-1');
    const report = next(FUNCTIONAL_TEST_NODE.Report);
    await must(execute, McpToolName.SubmitResult, { summary: '执行完成' });
    const input = {
      runId: run.id,
      executionIds: ['v1', 'v2', 'defect', 'scope', 'redirect', 'reset', 'redirect-write'],
    };
    expect((await call(report, McpToolName.TestReportSubmit, { ...input, executionIds: ['v2'] })).body.code).toBe(
      ErrorCode.ValidationFailed,
    );
    const written = await must(report, McpToolName.TestReportSubmit, input);
    expect(written.counts).toEqual({ passed: 1, failed: 1, blocked: 4, not_run: 0 });
    expect(written.markdown).toContain('v1 实测 · 失败');
    expect(written.markdown).toContain('v2 实测 · 通过');
    expect(written.markdown).not.toContain('fixture-secret');
    const published = await t.call(functionalTestReportReadOp, { taskId });
    expect(published.body.markdown).toBe(written.markdown);
    const review = taskReaches(t, TaskStatus.Review);
    const linkedTaskUpdate = (kind: 'repair' | 'rerun') =>
      waitForEvent(
        t.app.events,
        ServerEventType.TaskUpdated,
        (event) =>
          event.id === taskId &&
          t.app.services.tasks
            .detail(taskId)
            .testLinks?.some((link) => link.sourceId === taskId && link.kind === kind) === true,
      );
    const repairLinked = linkedTaskUpdate('repair');
    t.fake.enqueue(script().hang());
    await must(report, McpToolName.SubmitResult, { summary: '已生成报告' });
    await review;
    await repairLinked;
    const selection = { taskId, executionIds: ['defect'] };
    const automaticRepair = (await t.call(getTaskOp, { id: taskId })).body.testLinks?.find(
      ({ kind }) => kind === 'repair',
    );
    const repair = await t.call(functionalTestRepairOp, selection);
    expect(repair.status).toBe(200);
    expect(repair.body.taskId).toBe(automaticRepair?.taskId);
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
    const rerunStage = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt, taskId: candidate, nodeId }) =>
        candidate !== null &&
        candidate !== taskId &&
        attempt.status === AttemptStatus.Running &&
        t.app.services.tasks
          .detail(candidate)
          .nodes.some((node) => node.id === nodeId && node.key === FUNCTIONAL_TEST_NODE.Environment),
    );
    const rerunLinked = linkedTaskUpdate('rerun');
    const rerun = await t.call(functionalTestRerunOp, { ...selection, ref: commit });
    expect(rerun.status).toBe(200);
    await rerunLinked;
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
    const persistedRerun = (await t.call(functionalTestReadOp, { taskId: followup.id })).body;
    expect(persistedRerun.inheritedChecks).toEqual([probe]);
    expect(persistedRerun.runs).toEqual([]);
    // 上一版本已准备环境的复测任务没有继承定义，且模型另命名了探测条件。
    const { inheritedChecks, ...legacySnapshot } = persistedRerun;
    const originalRun = functionalTestRunSchema.parse(run);
    const legacyRun = {
      ...originalRun,
      id: 'legacy-run',
      environment: {
        ...originalRun.environment,
        id: 'legacy-run',
        checks: [{ key: 'preview-root', path: '/', expectedStatus: 200, ready: true, reason: null, status: 200 }],
      },
    };
    const db = new DatabaseSync(join(t.dataDir, 'app.db'));
    try {
      db.prepare('UPDATE functional_tests SET snapshot = ? WHERE task_id = ?').run(
        JSON.stringify({ ...legacySnapshot, runs: [legacyRun] }),
        followup.id,
      );
    } finally {
      db.close();
    }
    expect(requests.filter((request) => request === 'GET /health')).toHaveLength(1);
    const newRun = await must(rerunStage, McpToolName.TestEnvironmentPrepare, {
      checks: [
        { key: 'preview-root', path: '/', expectedStatus: 200 },
        { ...probe, path: '/different-path' },
      ],
    });
    expect(newRun.id).toBe('legacy-run');
    expect(newRun.environment).toMatchObject({
      checks: expect.arrayContaining([{ ...probe, status: 200, ready: true, reason: null }]),
    });
    expect(requests.filter((request) => request === 'GET /health')).toHaveLength(2);
    expect(requests).not.toContain('GET /different-path');
    t.fake.enqueue(script().hang());
    const rerunExecution = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt, taskId, nodeId }) =>
        taskId === followup.id &&
        attempt.status === AttemptStatus.Running &&
        t.app.services.tasks
          .detail(taskId)
          .nodes.some((node) => node.id === nodeId && node.key === FUNCTIONAL_TEST_NODE.Execute),
    );
    await must(rerunStage, McpToolName.SubmitResult, { summary: '已重新核实环境' });
    expect(
      (
        await must(rerunExecution, McpToolName.TestCaseRun, {
          runId: newRun.id,
          caseId: failedCase.id,
          version: 1,
          executionId: 'rerun-defect',
        })
      ).status,
    ).toBe('failed');
    expect((await fetch(origin)).status).toBe(200);
  } finally {
    await client?.close();
    await testApp?.close();
    app.close();
    outside.close();
  }
});

it('本地任务按已提交的脚本启动，用独立就绪地址探测，并在重启后恢复所保存的启动配置', async () => {
  const fake = createFakeOpencode();
  let t = await createTestApp({ fake });
  let mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const server = `import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.url === '/ready') res.writeHead(204).end();
  else if (req.url === '/ready-next') res.end(String(process.pid));
  else res.writeHead(404).end('订单不存在');
}).listen(Number(process.env.PORT), '127.0.0.1');`;
    const { project, repo } = await addProject(t, {
      files: {
        'orders/package.json': JSON.stringify({ name: 'orders-fixture', scripts: { dev: 'node server.mjs' } }),
        'orders/server.mjs': server,
      },
    });
    const created = await t.call(createTaskOp, {
      projectId: project.id,
      workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
      requirement: '验证不存在的订单返回 404',
      functionalTest: { target: '/orders', writes: [], caseAttachmentIds: [] },
      start: false,
    });
    expect(created.status).toBe(201);
    const taskId = created.body.id;
    const stage = (key: string) =>
      waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt, nodeId, taskId: id }) =>
          id === taskId &&
          attempt.status === AttemptStatus.Running &&
          t.app.services.tasks.detail(taskId).nodes.some((node) => node.id === nodeId && node.key === key),
      );
    const call = (attemptId: string, tool: McpToolName, args: Record<string, unknown> = {}) =>
      callTool(mcp, tool, { ...args, [MCP_SESSION_ARG]: t.app.services.attempts.get(attemptId).opencodeSessionId });
    const must = async (attemptId: string, tool: McpToolName, input?: Record<string, unknown>) => {
      const result = await call(attemptId, tool, input);
      expect(result.isError, JSON.stringify(result.body)).toBe(false);
      return result.body;
    };
    const prepare = async (attemptId: string, input?: Record<string, unknown>) =>
      functionalTestRunSchema.parse(await must(attemptId, McpToolName.TestEnvironmentPrepare, input));

    fake.enqueue(script().hang());
    const author = stage(FUNCTIONAL_TEST_NODE.Author);
    await t.call(startTaskOp, { id: taskId });
    const authorId = (await author).attempt.id;
    const testCase = await must(authorId, McpToolName.TestCaseSave, {
      title: '不存在的订单',
      requirement: '不存在的订单返回 404',
      steps: [
        {
          kind: 'http',
          title: '读取订单',
          method: 'GET',
          path: '/orders',
          assertions: [{ field: 'status', equals: 404, basis: '夹具契约' }],
        },
      ],
    });
    const failedCase = await must(authorId, McpToolName.TestCaseSave, {
      title: '订单应可读取',
      requirement: '指定订单返回 200',
      steps: [
        {
          kind: 'http',
          title: '读取订单',
          method: 'GET',
          path: '/orders',
          assertions: [{ field: 'status', equals: 200, basis: '夹具契约' }],
        },
      ],
    });
    fake.enqueue(script().hang());
    const environment = stage(FUNCTIONAL_TEST_NODE.Environment);
    await must(authorId, McpToolName.SubmitResult, { summary: '已保存用例' });
    const prepId = (await environment).attempt.id;
    await mkdir(join(repo.path, '.idea'), { recursive: true });
    await writeFile(
      join(repo.path, '.idea/workspace.xml'),
      '<project><component name="RunManager"><configuration type="Application" name="Local only"><option name="MAIN_CLASS_NAME" value="example.LocalService"/></configuration></component></project>',
    );
    const discovered = await must(prepId, McpToolName.TestIdeConfigurations);
    expect(discovered.configurations).toEqual([
      expect.objectContaining({ mainClass: 'example.LocalService', location: 'project' }),
    ]);

    const launch = { directory: 'orders', source: 'orders/package.json', script: 'dev', readyPath: '/ready' };
    const unsupported = { ...launch, script: 'unknown-script' };
    const invalidLaunch = await prepare(prepId, { launch: unsupported });
    expect(invalidLaunch.environment).toMatchObject({
      ready: false,
      reason: expect.stringContaining('committed service script'),
      logTail: '',
    });
    expect(invalidLaunch.environment).not.toHaveProperty('launch');
    expect(invalidLaunch.environment).not.toHaveProperty('command');
    expect(invalidLaunch.environment).not.toHaveProperty('readyStatus');
    const invalidProbe = await prepare(prepId, { launch: { ...launch, readyPath: '/not-ready' } });
    expect(invalidProbe.environment).toMatchObject({
      ready: false,
      readyStatus: 404,
      reason: expect.stringContaining('HTTP 404'),
      command: expect.stringContaining('run dev'),
      readyUrl: expect.stringMatching(/\/not-ready$/),
    });
    const ready = await prepare(prepId, { launch });
    expect(ready.id).toBe(invalidProbe.id);
    expect(ready.id).toBe(invalidLaunch.id);
    expect(ready.environment).toMatchObject({
      launch,
      ready: true,
      readyStatus: 204,
      verified: true,
      reason: null,
      command: expect.stringContaining('run dev'),
      readyUrl: expect.stringMatching(/\/ready$/),
    });
    expect((await fetch(ready.environment.target)).status).toBe(404);
    expect(await prepare(prepId, { launch })).toEqual(ready);

    const rejected = await call(prepId, McpToolName.TestEnvironmentPrepare, { launch: unsupported });
    expect(rejected.body).toMatchObject({ code: ErrorCode.ValidationFailed });
    const afterRejection = (await t.call(functionalTestReadOp, { taskId })).body;
    expect(afterRejection.runs).toEqual([ready]);
    expect(afterRejection.events.at(-1)?.detail).toEqual({
      launch: unsupported,
      reason: expect.stringContaining('committed service script'),
    });
    expect(await prepare(prepId)).toEqual(ready);

    const changed = { ...launch, readyPath: '/ready-next' };
    t.app.services.previews.acquire(taskId);
    try {
      const blocked = await call(prepId, McpToolName.TestEnvironmentPrepare, { launch: changed });
      expect(blocked.body).toMatchObject({ code: ErrorCode.StateTransitionInvalid });
      expect(await prepare(prepId)).toEqual(ready);
    } finally {
      t.app.services.previews.release(taskId);
    }
    const updated = await prepare(prepId, { launch: changed });
    expect(updated.environment).toMatchObject({ launch: changed, ready: true, readyStatus: 200 });
    expect(updated.id).toBe(ready.id);
    const originalPid = await (await fetch(updated.environment.readyUrl ?? '')).text();

    await mcp.close();
    const { dataDir } = t;
    await t.close();
    fake.enqueue(script().hang());
    t = await createTestApp({ dataDir, fake });
    mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
    const active = t.app.services.tasks
      .detail(taskId)
      .activeAttempts.find(({ status }) => status === AttemptStatus.Running);
    const recovered = active ?? (await stage(FUNCTIONAL_TEST_NODE.Environment)).attempt;
    const restored = await prepare(recovered.id);
    expect(restored.id).toBe(updated.id);
    expect(restored.environment).toMatchObject({ launch: changed, ready: true, readyStatus: 200 });
    expect(await (await fetch(restored.environment.readyUrl ?? '')).text()).not.toBe(originalPid);
    expect((await t.call(functionalTestReadOp, { taskId })).body.runs).toEqual([restored]);

    fake.enqueue(script().hang());
    const execute = stage(FUNCTIONAL_TEST_NODE.Execute);
    await must(recovered.id, McpToolName.SubmitResult, { summary: '已恢复测试环境' });
    const executeId = (await execute).attempt.id;
    const result = await must(executeId, McpToolName.TestCaseRun, {
      runId: restored.id,
      caseId: testCase.id,
      version: 1,
      executionId: 'missing-order',
    });
    expect(result.status).toBe('passed');
    const frozen = await call(executeId, McpToolName.TestEnvironmentPrepare, { launch });
    expect(frozen.body).toMatchObject({ code: ErrorCode.StateTransitionInvalid });
    const failureId = 'order-defect';
    const failed = await must(executeId, McpToolName.TestCaseRun, {
      runId: restored.id,
      caseId: failedCase.id,
      version: 1,
      executionId: failureId,
    });
    expect(failed.status).toBe('failed');

    const selection = { taskId, executionIds: [failureId] };
    fake.enqueue(script().hang(), { title: '定位根因' });
    const repairReady = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (value) => value.workflow.key === 'bugfix' && value.status === TaskStatus.Running,
    );
    const repair = await t.call(functionalTestRepairOp, selection);
    expect(repair.status).toBe(200);
    expect((await repairReady).id).toBe(repair.body.taskId);
    const repairDir = t.app.services.tasks.detail(repair.body.taskId).git.worktreePath;
    if (repairDir === null) throw new Error('Expected repair worktree');
    const fixedServer = server.replace(
      "else res.writeHead(404).end('订单不存在');",
      "else if (req.url === '/verify-fix') res.writeHead(204).end(); else res.end('已修复');",
    );
    await writeFile(join(repairDir, 'orders/server.mjs'), fixedServer);
    await repo.git('-C', repairDir, 'commit', '-am', '修复读取订单');
    const fixed = await repo.git('-C', repairDir, 'rev-parse', 'HEAD');

    fake.enqueue(script().hang(), { title: '准备环境' });
    const rerunStage = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt, taskId: id, nodeId }) =>
        id !== null &&
        id !== taskId &&
        attempt.status === AttemptStatus.Running &&
        t.app.services.tasks
          .detail(id)
          .nodes.some((node) => node.id === nodeId && node.key === FUNCTIONAL_TEST_NODE.Environment),
    );
    const rerun = await t.call(functionalTestRerunOp, { ...selection, ref: fixed });
    expect(rerun.status).toBe(200);
    const rerunAttempt = await rerunStage;
    expect(rerunAttempt.taskId).toBe(rerun.body.taskId);
    const inherited = await prepare(rerunAttempt.attempt.id);
    expect(inherited.id).not.toBe(restored.id);
    expect(inherited.environment).toMatchObject({
      launch: changed,
      baseline: fixed,
      ready: true,
      verified: true,
      readyStatus: 200,
    });
    expect(inherited.environment.readyUrl).not.toBe(restored.environment.readyUrl);
    expect(await (await fetch(inherited.environment.target)).text()).toBe('已修复');

    const replacement = { ...changed, readyPath: '/verify-fix' };
    const checked = await prepare(rerunAttempt.attempt.id, { launch: replacement });
    expect(checked.environment).toMatchObject({ launch: replacement, baseline: fixed, ready: true, readyStatus: 204 });
    const rerunRead = (await t.call(functionalTestReadOp, { taskId: rerun.body.taskId })).body;
    expect(rerunRead.events).toContainEqual(
      expect.objectContaining({
        kind: 'environment',
        detail: { launch: replacement, originalLaunch: changed, baseline: fixed },
      }),
    );
  } finally {
    await mcp.close();
    await t.close();
  }
});

it('解析节点读取 Markdown、TXT、Word 表格和 Excel 多工作表，并保存原编号与出处', async () => {
  const t = await createTestApp();
  const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const fixture = (name: string) => readFile(new URL(`../../../test/fixtures/office/${name}`, import.meta.url));
    const { project } = await addProject(t);
    const files = [
      { name: '订单用例.md', format: 'text', bytes: Buffer.from('# ORD-01\nGET /orders 应返回 200\n') },
      { name: '订单用例.txt', format: 'text', bytes: Buffer.from('ORD-01\nGET /orders 应返回 200\n') },
      { name: '订单用例.docx', format: 'docx', bytes: await fixture('report.libreoffice.docx') },
      { name: '订单用例.xlsx', format: 'xlsx', bytes: await fixture('sales.libreoffice.xlsx') },
    ];
    const attachments = await Promise.all(
      files.map(async ({ name, format, bytes }) => {
        const response = await t.request({
          method: 'POST',
          url: '/attachments',
          headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name) },
          payload: bytes,
        });
        expect(response.statusCode).toBe(201);
        const attachment = attachmentSchema.parse(response.json());
        expect(attachment).toMatchObject({ name, format });
        return attachment;
      }),
    );
    const [md, txt, docx, xlsx] = attachments;
    if (!md || !txt || !docx || !xlsx) throw new Error('Missing case attachments');
    const attachmentIds = attachments.map(({ id }) => id);
    const creation = await t.call(createTaskOp, {
      projectId: project.id,
      requirement: '从选定的四份材料导入案例',
      workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
      attachmentIds,
      functionalTest: { target: 'http://127.0.0.1:8080/orders', writes: [], caseAttachmentIds: attachmentIds },
      start: false,
    });
    expect(creation.status).toBe(201);
    const { id } = creation.body;
    t.fake.enqueue(script().hang());
    const started = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      ({ attempt, nodeId, taskId }) =>
        taskId === id &&
        attempt.status === AttemptStatus.Running &&
        t.app.services.tasks
          .detail(id)
          .nodes.some((node) => node.id === nodeId && node.key === FUNCTIONAL_TEST_NODE.Import),
    );
    await t.call(startTaskOp, { id });
    const { attempt } = await started;
    const session = t.app.services.attempts.get(attempt.id).opencodeSessionId;
    const must = async (name: McpToolName, input: Record<string, unknown> = {}) => {
      const { isError, body } = await callTool(mcp, name, { ...input, [MCP_SESSION_ARG]: session });
      expect(isError, JSON.stringify(body)).toBe(false);
      return body;
    };
    expect((await t.call(getTaskOp, { id })).body.nodes.map(({ key }) => key)).toEqual([
      FUNCTIONAL_TEST_NODE.Import,
      FUNCTIONAL_TEST_NODE.Environment,
      FUNCTIONAL_TEST_NODE.Execute,
      FUNCTIONAL_TEST_NODE.Report,
    ]);
    const context = await must(McpToolName.GetTaskContext);
    expect(context).toMatchObject({
      task: { functionalTest: { caseAttachmentIds: attachmentIds } },
      functionalTest: { phase: FUNCTIONAL_TEST_NODE.Import },
    });

    for (const file of [md, txt, docx]) {
      const result = await must(McpToolName.ReadAttachment, { attachment_id: file.id });
      expect(result.attachment_id).toBe(file.id);
      expect(result.text).toContain(file.id === docx.id ? '| order_id | string | 订单号 |' : 'GET /orders 应返回 200');
    }
    const summary = await must(McpToolName.ReadSheet, { attachment_id: xlsx.id, sheet: '汇总', range: 'A3:B4' });
    expect(summary).toMatchObject({
      range: 'A3:B4',
      rows: [
        { row: 3, values: ['华东', 1384] },
        { row: 4, values: ['华北', 707.5] },
      ],
    });
    const details = await must(McpToolName.ReadSheet, { attachment_id: xlsx.id, sheet: '明细', range: 'A1:B2' });
    expect(details).toMatchObject({ range: 'A1:B2', rows: [{ row: 1 }, { row: 2 }] });

    // 脚本替代模型映射，实际文件解析和用例保存均走应用工具。
    const sources = [
      { attachmentId: md.id, originalId: 'ORD-01', location: '标题 ORD-01，第 1–2 行' },
      { attachmentId: txt.id, originalId: 'ORD-01', location: '第 1–2 行' },
      { attachmentId: docx.id, originalId: 'order_id', location: '字段表，order_id 行' },
      { attachmentId: xlsx.id, originalId: '华东', location: '汇总!A3:B4' },
      { attachmentId: xlsx.id, originalId: '明细-2', location: '明细!A1:B2' },
    ];
    for (const [index, source] of sources.entries()) {
      const definition =
        index < 2
          ? {
              steps: [
                {
                  kind: 'http',
                  title: '读取订单',
                  method: 'GET',
                  path: '/orders',
                  assertions: [{ field: 'status', equals: 200, basis: source.location }],
                },
              ],
            }
          : { steps: [], needsClarification: '原文件没有接口预期' };
      await must(McpToolName.TestCaseSave, {
        title: '导入订单案例',
        requirement: '保留来源中的业务规则',
        source,
        ...definition,
      });
    }
    const snapshot = (await t.call(functionalTestReadOp, { taskId: id })).body;
    expect(snapshot.cases.map(({ source }) => source)).toEqual(sources);
    expect(new Set(snapshot.cases.map(({ id: caseId }) => caseId)).size).toBe(sources.length);
    expect(snapshot.cases.map(({ needsClarification }) => needsClarification !== undefined)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  } finally {
    await mcp.close();
    await t.close();
  }
});
