import { type TranscriptEntry, TranscriptEntryKind, TranscriptSystemEvent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { toolActionLabel } from '../../copy/attempts.ts';
import { lineDelta, processLines } from './process-lines.ts';

let seq = 0;
const call = (callId: string, tool: string, input: Record<string, unknown>): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  kind: TranscriptEntryKind.ToolCall,
  data: { tool, callId, input },
});
const result = (callId: string, tool: string, status: 'completed' | 'error'): TranscriptEntry => ({
  seq: ++seq,
  ts: 0,
  kind: TranscriptEntryKind.ToolResult,
  data: { tool, callId, status },
});
const labels = (entries: TranscriptEntry[]) =>
  processLines(entries, '/wt/T-1').map((l) =>
    l.kind === 'action' ? `${toolActionLabel(l.action)} [${l.state}]` : l.kind === 'text' ? l.text : l.kind,
  );

describe('processLines', () => {
  it('正文保留，工具调用写成人话并带上结果；发给 AI 的消息、思考与会话开始不显示', () => {
    const entries: TranscriptEntry[] = [
      { seq: ++seq, ts: 0, kind: TranscriptEntryKind.System, data: { event: TranscriptSystemEvent.AttemptStarted } },
      { seq: ++seq, ts: 0, kind: TranscriptEntryKind.UserMessage, data: { text: 'prompt' } },
      { seq: ++seq, ts: 0, partId: 'p1', kind: TranscriptEntryKind.Reasoning, data: { text: '想一想' } },
      { seq: ++seq, ts: 0, partId: 'p2', kind: TranscriptEntryKind.Text, data: { text: '先改时间换算。' } },
      call('c1', 'edit', { filePath: '/wt/T-1/src/a.ts', oldString: 'a\nb\nc', newString: 'a\nB\nB2\nc' }),
      result('c1', 'edit', 'completed'),
      call('c2', 'bash', { command: 'pnpm test\n# again' }),
      result('c2', 'bash', 'error'),
      call('c3', 'agent-workflow_report_progress', { message: '跑测试' }),
      call('c4', 'agent-workflow_submit_result', { summary: 'x' }),
    ];
    expect(labels(entries)).toEqual([
      '先改时间换算。',
      '编辑 src/a.ts +2 −1 [ok]',
      '运行 pnpm test [failed]',
      '进展：跑测试 [running]',
      '提交结果 [running]',
    ]);
  });

  it('Windows 路径也去掉工作区前缀', () => {
    const lines = processLines([call('c', 'read', { filePath: 'C:\\wt\\T-1\\src\\a.ts' })], 'C:\\wt\\T-1');
    expect(lines.map((l) => l.kind === 'action' && toolActionLabel(l.action))).toEqual(['查看 src/a.ts']);
  });
});

describe('lineDelta', () => {
  it('只计首尾相同行之间的增删', () => {
    expect(lineDelta('', 'x\ny\n')).toEqual({ added: 2, removed: 0 });
    expect(lineDelta('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 });
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 });
  });
});
