import { pathToFileURL } from 'node:url';
import { PromptName } from '@aw/builtin';
import { BashPolicy, RoleBaseAgent, readonlyBashRules, SessionAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { buildOpencodeConfig, type OpencodeConfigInput, sessionPermissionRules } from './opencode.config.ts';

// The generated configuration is the product here, so snapshots are the assertion (07 §3.3).
const PLUGIN_FILE = '/Applications/Agent Workflow.app/Contents/Resources/opencode-plugin/agent-workflow-bridge.js';

function configInput(shell: string | undefined, offline = false): OpencodeConfigInput {
  const prompts = Object.fromEntries(Object.values(PromptName).map((name) => [name, `<${name}.md>`]));
  return {
    mcpUrl: 'http://127.0.0.1:4000/mcp/exec',
    mcpToken: 'mcp-token',
    assistantMcpUrl: 'http://127.0.0.1:4000/mcp/assistant',
    assistantMcpToken: 'assistant-token',
    pluginFile: PLUGIN_FILE,
    prompts: prompts as Record<PromptName, string>,
    shell,
    offline,
  };
}

const config = (shell: string | undefined, offline = false) => buildOpencodeConfig(configInput(shell, offline));

describe('opencode 配置生成', () => {
  it('注入两套 MCP、三个基础 agent、知识研究员、PPT 写作者、Git 审查员、助手 agent 与 bridge 插件', () => {
    // The plugin URL depends on the platform's absolute paths (a drive letter on Windows).
    const { plugin, ...rest } = config(undefined);
    expect(plugin).toEqual([pathToFileURL(PLUGIN_FILE).href]);
    expect(rest).toMatchSnapshot();
  });

  it('固定 shell 时注入 shell（Windows 上的 Git Bash，D72），否则不设置', () => {
    expect(config('C:\\Program Files\\Git\\bin\\bash.exe').shell).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect('shell' in config(undefined)).toBe(false);
  });

  it('离线环境下隐藏 opencode 自带的 provider、禁用 websearch（D168），在线时不设置', () => {
    const { provider, permission } = config(undefined, true);
    expect({ provider, permission }).toMatchSnapshot();
    const online = config(undefined);
    expect('provider' in online || 'permission' in online).toBe(false);
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

  it('离线环境下打开网络检索只放行 webfetch（读内网网页），不放行 websearch（D168）', () => {
    const off = sessionPermissionRules(SessionAgent.Researcher, BashPolicy.Auto);
    const on = sessionPermissionRules(SessionAgent.Researcher, BashPolicy.Auto, { web: true, offline: true });
    expect(on.slice(off.length)).toEqual([{ permission: 'webfetch', pattern: '*', action: 'allow' }]);
  });
});
