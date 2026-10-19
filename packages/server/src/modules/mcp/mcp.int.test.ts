import { AttemptKind, ErrorCode, MCP_SESSION_ARG, McpToolName } from '@aw/shared';
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

/** An attempt of `kind` whose session is waiting (its turn never ends: a permission stays pending). */
async function activeSession(kind: AttemptKind): Promise<string> {
  t.fake.enqueue(script().requestPermission('bash', ['sleep 100']));
  const repo = await createTestRepo();
  const attempt = await t.app.services.attempts.start({
    kind,
    taskId: null,
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
      McpToolName.ReportProgress,
      McpToolName.SubmitResult,
    ]);
    const submit = tools.find((tool) => tool.name === McpToolName.SubmitResult);
    expect(submit?.inputSchema).toMatchObject({ type: 'object', required: ['summary'] });
    expect(JSON.stringify(tools)).not.toContain(MCP_SESSION_ARG);
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
