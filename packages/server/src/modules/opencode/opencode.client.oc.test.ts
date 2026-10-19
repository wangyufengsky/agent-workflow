import { BashPolicy, MCP_SERVER_NAME, OPENCODE_AGENT_NAME, RoleBaseAgent } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { sessionPermissionRules } from './opencode.config.ts';

/** Real opencode 1.19.0; no model is called (07 §2). */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.startRuntime(t.port);
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
});
