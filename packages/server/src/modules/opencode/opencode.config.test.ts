import { pathToFileURL } from 'node:url';
import { PromptName } from '@aw/builtin';
import { BashPolicy, RoleBaseAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { buildOpencodeConfig, sessionPermissionRules } from './opencode.config.ts';

// The generated configuration is the product here, so snapshots are the assertion (07 §3.3).
const PLUGIN_FILE = '/Applications/Agent Workflow.app/Contents/Resources/opencode-plugin/agent-workflow-bridge.js';

function config(shell: string | undefined) {
  const prompts = Object.fromEntries(Object.values(PromptName).map((name) => [name, `<${name}.md>`]));
  return buildOpencodeConfig({
    mcpUrl: 'http://127.0.0.1:4000/mcp/exec',
    mcpToken: 'mcp-token',
    pluginFile: PLUGIN_FILE,
    prompts: prompts as Record<PromptName, string>,
    shell,
  });
}

describe('opencode 配置生成', () => {
  it('注入 MCP、三个基础 agent 与 bridge 插件', () => {
    // The plugin URL depends on the platform's absolute paths (a drive letter on Windows).
    const { plugin, ...rest } = config(undefined);
    expect(plugin).toEqual([pathToFileURL(PLUGIN_FILE).href]);
    expect(rest).toMatchSnapshot();
  });

  it('固定 shell 时注入 shell（Windows 上的 Git Bash，D67），否则不设置', () => {
    expect(config('C:\\Program Files\\Git\\bin\\bash.exe').shell).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect('shell' in config(undefined)).toBe(false);
  });

  it.each(Object.values(BashPolicy))('ai.bashPolicy = %s 时各 agent 的会话 bash 规则', (policy) => {
    const rules = Object.fromEntries(
      Object.values(RoleBaseAgent).map((base) => [base, sessionPermissionRules(base, policy)]),
    );
    expect(rules).toMatchSnapshot();
  });
});
