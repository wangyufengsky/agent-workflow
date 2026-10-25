import {
  BashPolicy,
  ErrorCode,
  listExternalMcpOp,
  MCP_ASSISTANT_SERVER_NAME,
  MCP_SERVER_NAME,
  OPENCODE_AGENT_NAME,
  OPENCODE_ASSISTANT_AGENT,
  RoleBaseAgent,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { sessionPermissionRules } from './opencode.config.ts';

/** Real opencode 1.19.0; no model is called (07 §2). */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
});
afterEach(() => t.close());

describe('@opencode 客户端与配置注入', () => {
  it('注入的 MCP、agent 与插件出现在 opencode 配置中', async () => {
    const repo = await createTestRepo();
    const { data } = await t.app.services.runtime.sdk().config.get({ directory: repo.path }, { throwOnError: true });
    expect(data.mcp?.[MCP_SERVER_NAME]).toMatchObject({ type: 'remote', enabled: true });
    expect(data.agent?.[OPENCODE_AGENT_NAME.executor]).toMatchObject({
      mode: 'primary',
      permission: { edit: 'allow', question: 'deny', external_directory: 'deny' },
    });
    expect(data.plugin).toEqual(expect.arrayContaining([expect.stringMatching(/agent-workflow-bridge\.js$/)]));
    // The knowledge researcher only reads (18 §5.1).
    expect(data.agent?.[OPENCODE_AGENT_NAME.researcher]).toMatchObject({
      mode: 'primary',
      permission: { edit: 'deny', question: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny' },
    });
    // So does the PPT writer (23 §7.1).
    expect(data.agent?.[OPENCODE_AGENT_NAME.slides_writer]).toMatchObject({
      mode: 'primary',
      permission: { edit: 'deny', question: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny' },
    });
  });

  it('助手的 agent 与助手 MCP 也已注入，两套 MCP 都已连接（A-03）', async () => {
    const repo = await createTestRepo();
    const sdk = t.app.services.runtime.sdk();
    const { data } = await sdk.config.get({ directory: repo.path }, { throwOnError: true });
    expect(data.mcp?.[MCP_ASSISTANT_SERVER_NAME]).toMatchObject({ type: 'remote', enabled: true });
    expect(data.agent?.[OPENCODE_ASSISTANT_AGENT]).toMatchObject({
      mode: 'primary',
      permission: { edit: 'allow', question: 'deny', external_directory: 'deny', 'agent-workflow_*': 'deny' },
    });
    expect(data.agent?.[OPENCODE_AGENT_NAME.executor]?.permission).toMatchObject({ 'agent-workflow-app_*': 'deny' });
    const { data: status } = await sdk.mcp.status({ directory: repo.path }, { throwOnError: true });
    expect(status).toMatchObject({
      [MCP_SERVER_NAME]: { status: 'connected' },
      [MCP_ASSISTANT_SERVER_NAME]: { status: 'connected' },
    });
    // The settings list only the user's own servers (28 §4), whatever their global configuration has.
    const { body: external } = await t.call(listExternalMcpOp, {});
    const names = external.items.map((s) => s.name);
    expect(names).not.toContain(MCP_SERVER_NAME);
    expect(names).not.toContain(MCP_ASSISTANT_SERVER_NAME);
  });

  it('重复删除已经不存在的真实会话仍然成功，允许中断后重试清理', async () => {
    const repo = await createTestRepo();
    const client = t.app.services.opencode;
    const sessionId = await client.createSession({
      directory: repo.path,
      title: 'Idempotent session cleanup',
      agent: OPENCODE_ASSISTANT_AGENT,
      permission: [],
    });
    await client.deleteSession({ sessionId, directory: repo.path });
    await expect(
      t.app.services.runtime.sdk().session.get({ sessionID: sessionId, directory: repo.path }, { throwOnError: true }),
    ).rejects.toMatchObject({ cause: { status: 404, body: { name: 'NotFoundError' } } });
    await expect(client.deleteSession({ sessionId, directory: repo.path })).resolves.toBeUndefined();
  });

  it('真实 opencode 的不存在权限请求映射为明确的失效错误', async () => {
    const repo = await createTestRepo();
    await expect(
      t.app.services.opencode.replyPermission({
        permissionId: 'per_aw_missing_permission',
        directory: repo.path,
        reply: 'once',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PermissionRequestExpired });
  });

  it('在目录中建会话并带上会话级 bash 规则；可列出模型', async () => {
    const repo = await createTestRepo();
    const permission = sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask);
    const sessionId = await t.app.services.opencode.createSession({
      directory: repo.path,
      title: 'T-1 · oc test',
      agent: OPENCODE_AGENT_NAME.executor,
      permission,
    });
    const { data: session } = await t.app.services.runtime
      .sdk()
      .session.get({ sessionID: sessionId, directory: repo.path }, { throwOnError: true });
    expect(session).toMatchObject({ directory: repo.path, title: 'T-1 · oc test', permission });

    const models = await t.app.services.opencode.listModels();
    expect(models.available.length).toBeGreaterThan(0);
  });

  it('项目 opencode 配置里的 provider 只在按项目目录列模型时出现；没有声明上下文长度的为 null（D162）', async () => {
    const provider = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Project LAN',
      options: { baseURL: 'http://127.0.0.1:9/v1' },
      models: { bare: { name: 'Bare' }, sized: { name: 'Sized', limit: { context: 32_768, output: 4096 } } },
    };
    const repo = await createTestRepo({
      files: { 'opencode.json': JSON.stringify({ provider: { 'aw-lan': provider } }) },
    });
    const opencode = t.app.services.opencode;

    expect((await opencode.listModels()).available.filter((m) => m.providerId === 'aw-lan')).toEqual([]);
    expect((await opencode.listModels(repo.path)).available.filter((m) => m.providerId === 'aw-lan')).toEqual([
      { providerId: 'aw-lan', modelId: 'bare', name: 'Bare', contextLimit: null },
      { providerId: 'aw-lan', modelId: 'sized', name: 'Sized', contextLimit: 32_768 },
    ]);
  });
});
