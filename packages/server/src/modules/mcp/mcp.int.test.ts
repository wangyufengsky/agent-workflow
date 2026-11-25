import {
  AttemptKind,
  createWorkflowOp,
  ErrorCode,
  listMcpToolsOp,
  MCP_SESSION_ARG,
  McpToolName,
  OPENCODE_AGENT_NAME,
  RoleBaseAgent,
  requestChangesOp,
} from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';

import { addProject, createTask, taskReaches } from '../../../test/helpers/tasks.ts';

import { OpencodeEventType, ToolCallStatus } from '../opencode/index.ts';

let t: TestApp;
let mcp: Client;

beforeEach(async () => {
  t = await createTestApp();
  mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

/** An attempt of `kind` whose session keeps working (its turn never ends). */
async function activeSession(kind: AttemptKind): Promise<string> {
  t.fake.enqueue(script().hang());
  const repo = await createTestRepo();
  const attempt = await t.app.services.attempts.start({
    kind,
    agent: RoleBaseAgent.Executor,
    taskId: null,
    projectId: null,
    nodeId: null,
    roleId: null,
    directory: repo.path,
    title: 'T-1 · mcp',
    model: null,
    prompt: 'hello',
  });
  if (attempt.opencodeSessionId === null) throw new Error('attempt has no session');
  return attempt.opencodeSessionId;
}

describe('执行 MCP（/mcp/exec）', () => {
  it('令牌错误时拒绝连接（401）', async () => {
    await expect(connectMcp(t.mcpUrl, 'x'.repeat(64))).rejects.toMatchObject({ code: 401 });
    // The renderer token is not an MCP token either (D25).
    const res = await fetch(t.mcpUrl, { method: 'POST', headers: { Authorization: `Bearer ${'t'.repeat(64)}` } });
    expect(res.status).toBe(401);
  });

  it('列出工具及其输入 schema，不暴露注入的会话参数', async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      McpToolName.GetTaskContext,
      McpToolName.GetSubmissionGuide,
      McpToolName.GetNodeOutput,
      McpToolName.Recall,
      McpToolName.GetTaskDiff,
      McpToolName.DelegateReadonly,
      McpToolName.InspectDelegation,
      McpToolName.SubmitDelegation,
      McpToolName.ReadAttachment,
      McpToolName.ReadSheet,
      McpToolName.QuerySheet,
      McpToolName.ProcessDocument,
      McpToolName.AnalyzeImage,
      McpToolName.ReadOfficeFile,
      McpToolName.ReadTaskArtifact,
      McpToolName.WriteTaskText,
      McpToolName.WriteTaskDocx,
      McpToolName.WriteTaskXlsx,
      McpToolName.EditTaskXlsx,
      McpToolName.SubmitPlan,
      McpToolName.SubmitResult,
      McpToolName.TestCaseSave,
      McpToolName.TestIdeConfigurations,
      McpToolName.TestEnvironmentPrepare,
      McpToolName.TestCaseRun,
      McpToolName.TestCaseRevise,
      McpToolName.TestRunRead,
      McpToolName.TestReportSubmit,
      McpToolName.BrowserSubmitReport,
      McpToolName.SubmitReview,
      McpToolName.AskUser,
      McpToolName.ReportProgress,
      McpToolName.DbListConnections,
      McpToolName.DbDescribe,
      McpToolName.DbQuery,
      McpToolName.InvestigateDatabase,
      McpToolName.SubmitAnswer,
      McpToolName.SubmitOutline,
      McpToolName.SubmitSlide,
      McpToolName.SubmitFindings,
      McpToolName.SubmitCommitMessage,
      McpToolName.SubmitMemberAnalysis,
      McpToolName.SubmitBreakdown,
      McpToolName.BrowserOpen,
      McpToolName.BrowserSnapshot,
      McpToolName.BrowserClick,
      McpToolName.BrowserType,
      McpToolName.BrowserSelect,
      McpToolName.BrowserPress,
      McpToolName.BrowserWaitFor,
      McpToolName.BrowserInspect,
      McpToolName.BrowserLogs,
      McpToolName.BrowserViewport,
      McpToolName.BrowserScreenshot,
    ]);
    const submit = tools.find((tool) => tool.name === McpToolName.SubmitResult);
    expect(submit?.inputSchema).toMatchObject({ type: 'object', required: ['summary'] });
    const browserReport = tools.find((tool) => tool.name === McpToolName.BrowserSubmitReport);
    expect(browserReport?.inputSchema.required).toEqual(['summary']);
    expect(Object.keys(browserReport?.inputSchema.properties ?? {})).toEqual(['summary', 'notes']);
    expect(JSON.stringify(tools)).not.toContain(MCP_SESSION_ARG);
  });

  it('Recall 分页、截断上限，只读调用会话中完成的文本结果', async () => {
    const source = await activeSession(AttemptKind.Execute);
    const other = await activeSession(AttemptKind.Execute);
    const ref = { messageId: 'msg_source', partId: 'prt_source' };
    const output = `首🌱${'x'.repeat(4095)}`;
    const result = {
      type: OpencodeEventType.Tool,
      sessionId: source,
      ...ref,
      callId: 'call_read',
      tool: 'read',
      input: {},
      status: ToolCallStatus.Completed,
      output,
    } as const;
    t.fake.replay([result, { ...result, partId: 'prt_pending', status: ToolCallStatus.Running }]);
    const recall = (owner: string, args: Record<string, unknown>) =>
      callTool(mcp, McpToolName.Recall, { [MCP_SESSION_ARG]: owner, ...ref, ...args });
    expect((await recall(source, { limit: 2 })).body).toEqual({
      content: '首🌱',
      offset: 0,
      totalLength: 4097,
      nextOffset: 2,
    });
    expect((await recall(source, { offset: 2, limit: 99999 })).body).toEqual({
      content: 'x'.repeat(4095),
      offset: 2,
      totalLength: 4097,
      nextOffset: null,
    });
    expect((await recall(source, { limit: 99999 })).body).toMatchObject({
      nextOffset: 4096,
      content: output.slice(0, -1),
    });
    expect((await recall(source, { offset: 5000 })).body).toEqual({
      content: '',
      offset: 4097,
      totalLength: 4097,
      nextOffset: null,
    });
    for (const response of [
      await recall(other, {}),
      await recall(source, { messageId: 'msg_missing' }),
      await recall(source, { partId: 'prt_missing' }),
      await recall(source, { partId: 'prt_pending' }),
    ]) {
      expect(response).toMatchObject({
        isError: true,
        body: { code: ErrorCode.NotFound, hint: expect.stringContaining('current session') },
      });
      expect(response.body).not.toHaveProperty('content');
    }
    for (const args of [{ sessionId: source }, { directory: '/tmp' }]) {
      expect((await recall(other, args)).body.code).toBe(ErrorCode.ValidationFailed);
    }
    expect((await recall(await activeSession(AttemptKind.Delegation), {})).body.code).toBe(ErrorCode.McpToolNotAllowed);
  });

  it('工具页的清单（GET /mcp/tools）带允许的尝试类型与输入 schema', async () => {
    const { body } = await t.call(listMcpToolsOp, {});
    expect(body.items.map((tool) => tool.name)).toEqual((await mcp.listTools()).tools.map((tool) => tool.name));
    expect(body.items.find((tool) => tool.name === McpToolName.SubmitPlan)).toMatchObject({
      allowedKinds: ['plan'],
      inputSchema: { type: 'object', required: expect.arrayContaining(['summary', 'nodes']) },
    });
  });

  it('没有会话参数或会话不属于任何尝试时返回 MCP_ATTEMPT_UNRESOLVED', async () => {
    for (const args of [{}, { [MCP_SESSION_ARG]: 'ses_unknown' }]) {
      const { isError, body } = await callTool(mcp, McpToolName.GetTaskContext, args);
      expect(isError).toBe(true);
      expect(body).toMatchObject({
        code: ErrorCode.McpAttemptUnresolved,
        hint: expect.stringContaining('end your turn'),
      });
    }
  });

  it('尝试类型不允许该工具时返回 MCP_TOOL_NOT_ALLOWED', async () => {
    const session = await activeSession(AttemptKind.Plan);
    const { body } = await callTool(mcp, McpToolName.SubmitResult, { [MCP_SESSION_ARG]: session, summary: 'x' });
    expect(body).toMatchObject({ code: ErrorCode.McpToolNotAllowed, details: { kind: 'plan' } });
  });

  it('普通执行步骤不能用浏览器报告工具提交', async () => {
    const session = await activeSession(AttemptKind.Execute);
    const { body, isError } = await callTool(mcp, McpToolName.BrowserSubmitReport, {
      [MCP_SESSION_ARG]: session,
      summary: 'report',
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ code: ErrorCode.McpToolNotAllowed });
  });

  it('按会话选择规划和验收的提交契约；修正未通过的评审时保留原判定', async () => {
    const plan = { [MCP_SESSION_ARG]: await activeSession(AttemptKind.Plan) };
    const review = { [MCP_SESSION_ARG]: await activeSession(AttemptKind.Review) };
    expect((await callTool(mcp, 'get_submission_guide', plan)).body).toMatchObject({
      tool: 'submit_plan',
      required: ['summary', 'nodes'],
      example: { nodes: [expect.objectContaining({ key: 'implement' })] },
    });
    const refused = await callTool(mcp, 'submit_review', { ...review, verdict: 'fail', summary: '' });
    expect(refused.body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      guide: { example: { verdict: 'fail', issues: [{ severity: 'major' }] } },
    });
    expect((await callTool(mcp, 'get_submission_guide', review)).body).toMatchObject({
      lastRejection: { fields: ['summary'] },
      example: { verdict: 'fail' },
    });
    expect((await callTool(mcp, 'get_submission_guide', plan)).body).not.toHaveProperty('lastRejection');
  });

  it('参数不合法时返回 VALIDATION_FAILED、zod issues 与 hint', async () => {
    const session = await activeSession(AttemptKind.Execute);
    const { isError, body } = await callTool(mcp, McpToolName.SubmitResult, {
      [MCP_SESSION_ARG]: session,
      summary: '',
    });
    expect(isError).toBe(true);
    expect(body).toMatchObject({
      code: ErrorCode.ValidationFailed,
      details: { issues: [expect.objectContaining({ path: ['summary'] })] },
      hint: expect.stringContaining('details.issues'),
    });
  });
});

it('T-11 前端修改的首次拒绝列出所有无关字段，读取指引后仍可正常提交', async () => {
  const { project } = await addProject(t, { checkCommand: null });
  t.fake.enqueue(script().edit('index.html', '原页').callTool('submit_result', { summary: '首版完成' }), {
    title: '开发首版页面',
  });
  const review = taskReaches(t, 'review');
  const task = await createTask(t, { projectId: project.id, workflow: 'frontend' });
  await review;
  t.fake.enqueue(script().edit('index.html', '今日路线').hang(), { title: '界面修改 1' });
  await t.call(requestChangesOp, { id: task.id, reason: 'user', feedback: '加上今日路线' });
  const session = () => t.fake.sessions.find((s) => s.title.includes('界面修改 1'))?.id;
  await expect.poll(session).toBeTruthy();
  const auth = { [MCP_SESSION_ARG]: session() };
  const bad = {
    summary: '已添加今日路线',
    changes: [{ path: 'index.html', description: '显示三个停靠点' }],
    requirement_results: [],
    code_review: { scope: { kind: 'diff', from: 'a'.repeat(40), to: 'b'.repeat(40) }, findings: [] },
  };
  const first = await callTool(mcp, 'submit_result', { ...bad, ...auth });
  expect(first.body).toMatchObject({
    code: ErrorCode.RequirementResultsInvalid,
    guide: {
      tool: 'submit_result',
      remove: expect.arrayContaining(['code_review', 'requirement_results']),
      example: { summary: bad.summary },
    },
  });
  const second = await callTool(mcp, 'submit_result', {
    ...bad,
    handoff: { facts: [], decisions: [], openQuestions: [] },
    ...auth,
  });
  expect(second.body).toMatchObject({
    code: ErrorCode.ValidationFailed,
    guide: { remove: expect.arrayContaining(['handoff', 'code_review', 'requirement_results']) },
  });
  const guide = await callTool(mcp, 'get_submission_guide', auth);
  expect(guide.body).toMatchObject({
    tool: 'submit_result',
    required: ['summary'],
    example: { summary: bad.summary },
    lastRejection: { code: ErrorCode.ValidationFailed, fields: ['handoff'] },
    omit: expect.arrayContaining(['code_review', 'requirement_results']),
  });
  const fixed = (first.body.guide as { example: Record<string, unknown> }).example;
  const revised = taskReaches(t, 'review');
  expect((await callTool(mcp, 'submit_result', { ...fixed, ...auth })).body).toMatchObject({ accepted: true });
  await revised;
});

it('数据库分析节点通过 MCP 直连也只允许其已声明工具', async () => {
  const { project } = await addProject(t);
  const role = RoleBaseAgent.DatabaseAnalyst;
  const key = 'db_analyst_permissions';
  const workflow = await t.call(createWorkflowOp, {
    key,
    name: '数据库分析权限',
    planning: 'fixed',
    deliverable: 'report',
    definition: {
      allowedRoles: [role],
      checkpoints: { confirm_plan: false, accept_each_node: false },
      defaultAcceptance: { checks: [], manual: false },
      template: {
        nodes: [{ key: 'analyze', title: '调查数据', roleKey: role, instructions: '只读分析', dependsOn: [] }],
      },
    },
  });
  expect(workflow.status).toBe(201);
  const agent = OPENCODE_AGENT_NAME[role];
  t.fake.enqueue(script().hang(), { agent });
  const task = await createTask(t, { projectId: project.id, workflow: key });
  await expect.poll(() => t.fake.prompts.some((prompt) => prompt.agent === agent)).toBe(true);
  const session = t.fake.sessions.find((entry) => entry.agent === agent);
  if (session === undefined) throw new Error('The database analysis role did not start');
  const context = { [MCP_SESSION_ARG]: session.id };
  const denied = await callTool(mcp, McpToolName.GetTaskDiff, context);
  expect(denied).toMatchObject({ isError: true, body: { code: ErrorCode.McpToolNotAllowed } });
  const allowed = await callTool(mcp, McpToolName.GetTaskContext, context);
  expect(allowed).toMatchObject({ isError: false, body: { task: { key: task.key } } });
});
