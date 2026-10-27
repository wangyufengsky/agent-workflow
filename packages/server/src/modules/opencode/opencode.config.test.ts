import { pathToFileURL } from 'node:url';
import { AGENT_SKILLS_MAX, PromptName, SkillName } from '@aw/builtin';
import { BashPolicy, OPENCODE_ASSISTANT_AGENT, RoleBaseAgent, readonlyBashRules, SessionAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildOpencodeConfig,
  type OpencodeConfigInput,
  opencodeLaunchEnv,
  sessionPermissionRules,
} from './opencode.config.ts';

// The generated configuration is the product here, so snapshots are the assertion (07 §3.3).
const PLUGIN_FILE = '/Applications/Agent Workflow.app/Contents/Resources/opencode-plugin/agent-workflow-bridge.js';
const SKILLS_DIR = '/Applications/Agent Workflow.app/Contents/Resources/skills';

function configInput(shell: string | undefined, offline = false): OpencodeConfigInput {
  const prompts = Object.fromEntries(Object.values(PromptName).map((name) => [name, `<${name}.md>`]));
  return {
    mcpUrl: 'http://127.0.0.1:4000/mcp/exec',
    mcpToken: 'mcp-token',
    assistantMcpUrl: 'http://127.0.0.1:4000/mcp/assistant',
    assistantMcpToken: 'assistant-token',
    pluginFile: PLUGIN_FILE,
    skillsDir: SKILLS_DIR,
    prompts: prompts as Record<PromptName, string>,
    shell,
    offline,
  };
}

const config = (shell: string | undefined, offline = false) => buildOpencodeConfig(configInput(shell, offline));

/** The `skill` rule of each agent in the generated configuration, which is plain JSON for opencode. */
const agentSkillRules = z.record(
  z.string(),
  z.object({
    permission: z.object({
      skill: z.union([z.literal('deny'), z.record(z.string(), z.enum(['allow', 'deny']))]).optional(),
    }),
  }),
);

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

  it('注入应用自带的 skill 目录；各 agent 只放行分配给它的 skill，拒绝全部的规则在最前（D207、D212）', () => {
    const { skills, agent } = config(undefined);
    expect(skills).toEqual({ paths: [SKILLS_DIR] });
    // The companion has no skill rule: it denies every tool already.
    const rules = Object.entries(agentSkillRules.parse(agent)).flatMap(([name, a]) =>
      a.permission.skill === undefined ? [] : [[name, a.permission.skill] as const],
    );
    expect(rules).toHaveLength(Object.values(SessionAgent).length + 1);
    for (const [, rule] of rules) {
      if (rule === 'deny') continue;
      const [first, ...allowed] = Object.entries(rule);
      expect(first).toEqual(['*', 'deny']);
      expect(allowed.every(([, action]) => action === 'allow')).toBe(true);
      expect(allowed.length).toBeLessThanOrEqual(AGENT_SKILLS_MAX);
    }
    expect(Object.fromEntries(rules)[OPENCODE_ASSISTANT_AGENT]).toEqual({
      '*': 'deny',
      [SkillName.TaskRequirement]: 'allow',
      [SkillName.TaskDiagnosis]: 'allow',
      [SkillName.RecurringWork]: 'allow',
      [SkillName.OfficeDocs]: 'allow',
      [SkillName.AssistantCharts]: 'allow',
    });
  });

  it('启动 opencode 时始终跳过 .claude 与 .agents 下的 skill（D207），与离线开关无关', () => {
    for (const offline of [false, true]) {
      expect(opencodeLaunchEnv(configInput(undefined, offline))).toMatchObject({
        OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
      });
    }
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
