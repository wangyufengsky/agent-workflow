import { PromptName } from '@aw/builtin';
import { BashPolicy, RoleBaseAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { buildOpencodeConfig, sessionPermissionRules } from './opencode.config.ts';

// The generated configuration is the product here, so snapshots are the assertion (07 §3.3).
describe('opencode 配置生成', () => {
  it('注入 MCP、三个基础 agent 与 bridge 插件', () => {
    const prompts = Object.fromEntries(Object.values(PromptName).map((name) => [name, `<${name}.md>`]));
    const config = buildOpencodeConfig({
      mcpUrl: 'http://127.0.0.1:4000/mcp/exec',
      mcpToken: 'mcp-token',
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
});

describe('只读会话的检查命令', () => {
  it('规划者与评审者可不经询问运行项目检查命令（最后一条规则生效），执行者的规则不变', () => {
    const checks = ['node --test', 'node --test'];
    const reviewer = sessionPermissionRules(RoleBaseAgent.Reviewer, BashPolicy.Ask, checks);
    expect(reviewer.at(0)).toEqual({ permission: 'bash', pattern: '*', action: 'ask' });
    expect(reviewer.filter((r) => r.pattern.startsWith('node'))).toEqual([
      { permission: 'bash', pattern: 'node --test*', action: 'allow' },
    ]);
    expect(reviewer.at(-1)?.pattern).toBe('node --test*');
    expect(sessionPermissionRules(RoleBaseAgent.Planner, BashPolicy.Auto, checks).at(-1)?.pattern).toBe('node --test*');
    expect(sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask, checks)).toEqual(
      sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask),
    );
  });
});
