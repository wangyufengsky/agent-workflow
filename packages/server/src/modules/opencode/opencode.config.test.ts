import { PromptName } from '@aw/builtin';
import { BashPolicy, RoleBaseAgent, readonlyBashRules, SessionAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { buildOpencodeConfig, sessionPermissionRules } from './opencode.config.ts';

// The generated configuration is the product here, so snapshots are the assertion (07 §3.3).
describe('opencode 配置生成', () => {
  it('注入两套 MCP、三个基础 agent、知识研究员、助手 agent 与 bridge 插件', () => {
    const prompts = Object.fromEntries(Object.values(PromptName).map((name) => [name, `<${name}.md>`]));
    const config = buildOpencodeConfig({
      mcpUrl: 'http://127.0.0.1:4000/mcp/exec',
      mcpToken: 'mcp-token',
      assistantMcpUrl: 'http://127.0.0.1:4000/mcp/assistant',
      assistantMcpToken: 'assistant-token',
      pluginFile: '/Applications/Agent Workflow.app/Contents/Resources/opencode-plugin/agent-workflow-bridge.js',
      prompts: prompts as Record<PromptName, string>,
    });
    expect(config).toMatchSnapshot();
  });

  it.each(Object.values(BashPolicy))('ai.bashPolicy = %s 时各 agent 的会话 bash 规则', (policy) => {
    const rules = Object.fromEntries(
      Object.values(RoleBaseAgent).map((base) => [base, sessionPermissionRules(base, policy)]),
    );
    expect(rules).toMatchSnapshot();
  });

  it('知识研究员只有在打开网络检索时才放行 webfetch 与 websearch，且排在最后', () => {
    const off = sessionPermissionRules(SessionAgent.Researcher, BashPolicy.Auto);
    const on = sessionPermissionRules(SessionAgent.Researcher, BashPolicy.Auto, { web: true });
    expect(off).toEqual(readonlyBashRules());
    expect(on.slice(0, off.length)).toEqual(off);
    expect(on.slice(off.length)).toEqual([
      { permission: 'webfetch', pattern: '*', action: 'allow' },
      { permission: 'websearch', pattern: '*', action: 'allow' },
    ]);
  });
});
