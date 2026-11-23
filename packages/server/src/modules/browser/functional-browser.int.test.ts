import {
  AttemptStatus,
  cancelTaskOp,
  createTaskOp,
  FUNCTIONAL_TEST_NODE,
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  functionalTestCaseSaveSchema,
  PreviewState,
  ServerEventType,
  startTaskOp,
  updateProjectOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, workflowId } from '../../../test/helpers/tasks.ts';
import { createChromiumHost } from './host.chromium.ts';

const server = `
import { createServer } from 'node:http';
let done = false;
createServer((req, res) => {
  if (req.url === '/wait') { console.log('waiting'); return; }
  if (req.method === 'POST' && req.url === '/done') { done = true; res.end('true'); return; }
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.end('<button id="complete">Complete</button><p id="state">'+(done ? 'Done' : 'Open')+'</p>'
    + '<script>document.querySelector("#complete").onclick = async () => { await fetch("/done",{method:"POST"}); document.querySelector("#state").textContent="Done"; }</script>');
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('token=fixture-sensitive'));
`;

it('在本地工作区测试页面点击和刷新，证据落盘后取消并回收本轮服务', async () => {
  const host = createChromiumHost();
  const t = await createTestApp({ browserHost: host });
  try {
    const contract = JSON.stringify({
      openapi: '3.1.0',
      paths: {
        '/done': {
          post: {
            responses: { 200: { description: 'Done' } },
            requestBody: { content: { 'application/json': { schema: { properties: { done: {}, note: {} } } } } },
          },
        },
      },
    });
    const { project } = await addProject(t, { files: { 'server.mjs': server, 'openapi.json': contract } });
    await t.call(updateProjectOp, {
      id: project.id,
      preview: {
        command: 'node server.mjs',
        setupCommand: null,
        readyPath: '/',
        pages: ['/'],
        extraOrigins: [],
      },
    });
    const created = await t.call(createTaskOp, {
      projectId: project.id,
      requirement: '本地页面测试',
      workflowId: await workflowId(t, FUNCTIONAL_TEST_WORKFLOW_KEY),
      functionalTest: { target: '/', writes: [{ method: 'POST', path: '/done' }], caseAttachmentIds: [] },
      checkpoints: { confirm_plan: false, accept_each_node: false, ask_on_uncertainty: false },
      start: false,
    });
    expect(created.status).toBe(201);
    const taskId = created.body.id;
    const { functionalTests: tests, previews, tasks, attempts } = t.app.services;
    const next = (key: string) => {
      t.fake.enqueue(script().hang());
      return waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        ({ attempt, nodeId, taskId: task }) =>
          task === taskId &&
          attempt.status === AttemptStatus.Running &&
          tasks.detail(taskId).nodes.some((node) => node.id === nodeId && node.key === key),
      );
    };
    const author = next(FUNCTIONAL_TEST_NODE.Author);
    await t.call(startTaskOp, { id: taskId });
    const authored = attempts.get((await author).attempt.id);
    const definition = tests.save(
      authored,
      functionalTestCaseSaveSchema.parse({
        title: '完成操作和刷新保持一致',
        requirement: '点击完成后，刷新能看到保存结果',
        steps: [
          {
            kind: 'browser',
            title: '初始状态',
            action: { kind: 'check' },
            expect: { kind: 'text', selector: '#state', value: 'Open' },
            basis: '需求',
          },
          {
            kind: 'browser',
            title: '点击完成',
            action: { kind: 'click', selector: '#complete' },
            expect: { kind: 'text', selector: '#state', value: 'Done' },
            basis: '需求',
          },
          {
            kind: 'browser',
            title: '刷新后仍完成',
            action: { kind: 'reload' },
            expect: { kind: 'text', selector: '#state', value: 'Done' },
            basis: '需求',
          },
        ],
      }),
    );
    const hanging = tests.save(
      authored,
      functionalTestCaseSaveSchema.parse({
        title: '请求中取消',
        requirement: '写入未响应时保留待核实证据',
        steps: [
          {
            kind: 'http',
            title: '等待响应',
            method: 'GET',
            path: '/wait',
            assertions: [{ field: 'status', equals: 200, basis: '测试夹具' }],
          },
        ],
      }),
    );
    const statusCase = tests.save(
      authored,
      functionalTestCaseSaveSchema.parse({
        title: '提交成功的状态码',
        requirement: '服务确认完成操作',
        steps: [
          {
            kind: 'http',
            title: '完成',
            method: 'POST',
            path: '/done',
            body: { state: true, note: { source: 'original' } },
            assertions: [{ field: 'status', equals: 201, basis: '已确认的 OpenAPI 契约' }],
          },
        ],
      }),
    );
    const prep = next(FUNCTIONAL_TEST_NODE.Environment);
    await tasks.submitResult(authored, { summary: '已保存案例' });
    const preparing = attempts.get((await prep).attempt.id);
    const run = await tests.prepare(preparing, {}, undefined);
    expect(run.environment).toMatchObject({
      verified: true,
      ready: true,
      logTail: expect.stringContaining('token=[redacted]'),
    });
    expect(run.environment.logTail).not.toContain('fixture-sensitive');
    expect(previews.get(taskId).state).toBe(PreviewState.Running);
    const execute = next(FUNCTIONAL_TEST_NODE.Execute);
    await tasks.submitResult(preparing, { summary: '服务就绪' });
    const runner = attempts.get((await execute).attempt.id);
    const test = { runId: run.id, caseId: definition.id, version: definition.version, executionId: 'browser' };
    expect(await tests.execute(runner, test)).toMatchObject({ status: 'passed' });
    const events = tests.getCaseExecution(taskId, 'browser').events;
    expect(events.find(({ kind, step }) => kind === 'result' && step === 1)?.detail.requests).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'POST', status: 200 })]),
    );
    expect(events.find(({ kind, step }) => kind === 'assertion' && step === 2)?.detail).toMatchObject({ passed: true });
    const trial = { ...test, caseId: statusCase.id, executionId: 'status-v1' };
    expect((await tests.execute(runner, trial)).status).toBe('failed');
    const statusStep = statusCase.steps[0];
    if (statusStep?.kind !== 'http') throw new Error('Expected the HTTP status step');
    const proposal = {
      caseId: trial.caseId,
      version: 1,
      executionId: trial.executionId,
      contractPath: 'openapi.json',
      reason: '纠正契约转写',
      basis: 'openapi.json /done POST',
    };
    const { id, version, number, ...saved } = statusCase;
    for (const step of [
      { ...statusStep, assertions: [{ field: 'status', equals: 200, basis: '同时替换依据' }] },
      { ...statusStep, assertions: [{ field: 'status', equals: '200', basis: '已确认的 OpenAPI 契约' }] },
      { ...statusStep, body: { done: true, note: { source: 'changed' } } },
      { ...statusStep, body: { done: false, note: { source: 'original' } } },
    ]) {
      const result = await tests.revise(runner, { ...proposal, definition: { ...saved, steps: [step] } });
      expect(result).toMatchObject({ case: statusCase, pending: true });
    }
    const revision = await tests.revise(runner, {
      caseId: trial.caseId,
      version: 1,
      executionId: trial.executionId,
      change: { kind: 'correct_success_status', step: 0, expected: 200 },
      contractPath: 'openapi.json',
      reason: '纠正状态码转写',
      basis: 'openapi.json /done POST responses',
    });
    expect(revision).toMatchObject({ case: { version: 2 }, pending: false });
    expect((await tests.execute(runner, { ...trial, version: 2, executionId: 'status-v2' })).status).toBe('passed');
    expect(tests.getCaseExecution(taskId, 'status-v1').events).toContainEqual(
      expect.objectContaining({
        kind: 'assertion',
        detail: expect.objectContaining({ expected: 201, actual: 200, passed: false }),
      }),
    );
    const started = waitForEvent(
      t.app.events,
      ServerEventType.FunctionalTestUpdated,
      ({ taskId: task }) =>
        task === taskId &&
        tests.read(taskId).events.some((event) => event.executionId === 'waiting' && event.kind === 'action'),
    );
    const pending = tests.execute(runner, { ...test, caseId: hanging.id, executionId: 'waiting' });
    await started;
    expect((await t.call(cancelTaskOp, { id: taskId })).status).toBe(200);
    expect(await pending).toMatchObject({ status: 'blocked' });
    expect(previews.get(taskId).state).toBe(PreviewState.Stopped);
    await expect(fetch(run.environment.target)).rejects.toThrow();
    expect(tests.getCaseExecution(taskId, 'browser').execution.status).toBe('passed');
  } finally {
    await t.close();
    await host.close();
  }
});
