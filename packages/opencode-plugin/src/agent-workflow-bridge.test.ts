import { MCP_SESSION_ARG, MCP_TOOL_PREFIX } from '@aw/shared';
import type { PluginInput } from '@opencode-ai/plugin';
import { describe, expect, it } from 'vitest';
import bridge from './agent-workflow-bridge.ts';

describe('agent-workflow-bridge 插件', () => {
  it('只给本项目的 MCP 工具原地注入会话 id', async () => {
    const hooks = await bridge.server({} as PluginInput);
    const before = hooks['tool.execute.before'];
    if (before === undefined) throw new Error('hook missing');
    const ours = { args: { summary: 'x' } };
    const native = { args: { command: 'ls' } };
    await before({ tool: `${MCP_TOOL_PREFIX}submit_result`, sessionID: 'ses_1', callID: 'c1' }, ours);
    await before({ tool: 'bash', sessionID: 'ses_1', callID: 'c2' }, native);
    expect(ours.args).toEqual({ summary: 'x', [MCP_SESSION_ARG]: 'ses_1' });
    expect(native.args).toEqual({ command: 'ls' });
  });
});
