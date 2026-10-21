import { type TranscriptEntry, TranscriptEntryKind } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { researchSteps } from './research-steps.ts';

let seq = 0;
const call = (tool: string, input: Record<string, unknown> = {}): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  kind: TranscriptEntryKind.ToolCall,
  data: { tool, callId: `c${seq}`, input },
});
const result = (tool: string, status: 'completed' | 'error'): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  kind: TranscriptEntryKind.ToolResult,
  data: { tool, callId: `c${seq}`, status },
});

describe('researchSteps', () => {
  it('没有工具调用时还在理解问题', () => {
    expect(researchSteps([], '/repo')).toEqual({ current: 'understand', searches: 0, reads: [], rejected: false });
  });

  it('检索与读取按工具与 bash 命令归类，读过的原文去重并去掉仓库路径', () => {
    const entries = [
      call('grep', { pattern: 'round' }),
      call('bash', { command: 'rg -n refund src' }),
      call('bash', { command: 'npm test' }),
      call('read', { filePath: '/repo/src/refund.ts' }),
      call('bash', { command: 'cat src/refund.ts' }),
      call('read', { filePath: '/repo/src/refund.ts' }),
      call('agent-workflow_db_query', { connection: 'shop', sql: 'SELECT 1' }),
    ];
    expect(researchSteps(entries, '/repo')).toEqual({
      current: 'read',
      searches: 2,
      reads: ['src/refund.ts', 'cat src/refund.ts', 'SELECT 1'],
      rejected: false,
    });
  });

  it('查完资料后开始写正文即进入组织回答；之后再查资料又回到读取', () => {
    const text = (t: string): TranscriptEntry => ({
      seq: ++seq,
      ts: 0,
      partId: `p${seq}`,
      kind: TranscriptEntryKind.Text,
      data: { text: t },
    });
    const read = call('read', { filePath: '/repo/a.ts' });
    expect(researchSteps([read, text('It is [1].')], '/repo').current).toBe('answer');
    const more = [read, text('Let me check.'), call('read', { filePath: '/repo/b.ts' })];
    expect(researchSteps(more, '/repo').current).toBe('read');
  });

  it('提交回答后进入组织回答；被拒绝时标出正在修正，重提通过后不再标出', () => {
    const rejected = [call('agent-workflow_submit_answer'), result('agent-workflow_submit_answer', 'error')];
    expect(researchSteps(rejected, '/repo')).toMatchObject({ current: 'answer', rejected: true });
    const accepted = [
      ...rejected,
      call('agent-workflow_submit_answer'),
      result('agent-workflow_submit_answer', 'completed'),
    ];
    expect(researchSteps(accepted, '/repo')).toMatchObject({ current: 'answer', rejected: false });
  });
});
