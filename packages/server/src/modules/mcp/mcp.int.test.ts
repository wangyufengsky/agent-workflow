import { AttemptKind, ErrorCode, listMcpToolsOp, MCP_SESSION_ARG, McpToolName, RoleBaseAgent } from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';

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
      McpToolName.GetNodeOutput,
      McpToolName.GetTaskDiff,
      McpToolName.ReadAttachment,
      McpToolName.ReadSheet,
      McpToolName.QuerySheet,
      McpToolName.ReadOfficeFile,
      McpToolName.SubmitPlan,
      McpToolName.SubmitResult,
      McpToolName.SubmitReview,
      McpToolName.AskUser,
      McpToolName.ReportProgress,
      McpToolName.DbListConnections,
      McpToolName.DbDescribe,
      McpToolName.DbQuery,
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
    expect(JSON.stringify(tools)).not.toContain(MCP_SESSION_ARG);
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
