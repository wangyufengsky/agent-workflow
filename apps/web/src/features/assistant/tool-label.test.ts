import { AssistantToolName, MCP_ASSISTANT_TOOL_PREFIX } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { describeTool } from './tool-label.ts';

const app = (name: string) => `${MCP_ASSISTANT_TOOL_PREFIX}${name}`;

describe('助手工具调用的显示', () => {
  it('应用的操作用操作标题，不出现内部工具名', () => {
    const info = describeTool(app('projects_create'), { repoPath: '/repo', name: '库存服务' });
    expect(info.title).toBe('添加项目');
    expect(info.operation?.id).toBe('projects.create');
  });

  it('助手专用工具与 opencode 原生工具用动作描述，原生工具带上它处理的对象', () => {
    expect(describeTool(app(AssistantToolName.OpenPage), { page: 'inbox' }).title).toBe('打开页面');
    expect(describeTool('read', { filePath: '/data/assistant/files/c1/周报.md' })).toEqual({
      title: '读取文件',
      subject: '周报.md',
    });
    expect(describeTool('bash', { command: 'ls src' }).subject).toBe('ls src');
  });

  it('用户自己的 MCP 工具显示为外部工具', () => {
    expect(describeTool('calendar_list_events', {}).title).toBe('使用外部工具');
  });
});
