import { type TranscriptEntry, TranscriptEntryKind, TranscriptSystemEvent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { actionGroupSummary, toolActionLabel } from '../../copy/attempts.ts';
import { lineDelta, type StreamItem, streamItems } from './stream-items.ts';

let seq = 0;
const at = (s: number) => s * 1000;
const call = (callId: string, tool: string, input: Record<string, unknown>, ts = 0): TranscriptEntry => ({
  seq: ++seq,
  ts,
  kind: TranscriptEntryKind.ToolCall,
  data: { tool, callId, input },
});
const result = (callId: string, tool: string, status: 'completed' | 'error', ts = 0): TranscriptEntry => ({
  seq: ++seq,
  ts,
  kind: TranscriptEntryKind.ToolResult,
  data: { tool, callId, status, ...(status === 'error' ? { error: 'exit 1' } : { output: 'ok' }) },
});
const part = (kind: 'text' | 'reasoning', text: string, ts = 0): TranscriptEntry => ({
  seq: ++seq,
  ts,
  partId: `p${seq}`,
  kind,
  data: { text, offset: 0 },
});
const read = (callId: string) => [
  call(callId, 'read', { filePath: `/wt/T-1/${callId}.ts` }),
  result(callId, 'read', 'completed'),
];

const shown = (items: StreamItem[]) =>
  items.map((i) => {
    switch (i.kind) {
      case 'action':
        return `${toolActionLabel(i.action)} [${i.state}]`;
      case 'group':
        return `group: ${actionGroupSummary(i.actions)}`;
      case 'text':
        return i.writing ? `${i.text}▍` : i.text;
      case 'thinking':
        return `thinking ${i.seconds}s${i.writing ? ' ▍' : ''}: ${i.text}`;
      case 'progress':
        return `progress: ${i.text}`;
      case 'wait':
        return `wait ${i.permission}${i.waiting ? ' (waiting)' : ''}`;
      case 'notice':
        return `notice ${i.event}${i.waiting ? ' (waiting)' : ''}`;
      default:
        return i.kind;
    }
  });
const items = (entries: TranscriptEntry[], opts: { pro?: boolean; ended?: boolean } = {}) =>
  streamItems(entries, { directory: '/wt/T-1', pro: opts.pro ?? false, ended: opts.ended ?? false });

describe('streamItems', () => {
  it('思考与正文都保留，思考的用时从前一条算起；工具调用写成人话并带上结果；会话开始不显示', () => {
    const entries: TranscriptEntry[] = [
      {
        seq: ++seq,
        ts: at(0),
        kind: TranscriptEntryKind.System,
        data: { event: TranscriptSystemEvent.AttemptStarted },
      },
      { seq: ++seq, ts: at(0), kind: TranscriptEntryKind.UserMessage, data: { text: 'prompt' } },
      part('reasoning', 'The loop skips the last row.', at(6)),
      part('text', '先改时间换算。', at(7)),
      call('c1', 'edit', { filePath: '/wt/T-1/src/a.ts', oldString: 'a\nb\nc', newString: 'a\nB\nB2\nc' }, at(8)),
      result('c1', 'edit', 'completed', at(8)),
      call('c2', 'bash', { command: 'pnpm test\n# again' }, at(9)),
      result('c2', 'bash', 'error', at(10)),
      call('c3', 'agent-workflow_report_progress', { message: '跑测试' }, at(10)),
      call('c4', 'agent-workflow_submit_result', { summary: 'x' }, at(11)),
    ];
    expect(shown(items(entries))).toEqual([
      'thinking 6s: The loop skips the last row.',
      '先改时间换算。',
      '编辑 src/a.ts +2 −1 [ok]',
      '运行 pnpm test [failed]',
      'progress: 跑测试',
      '提交结果 [running]',
    ]);
    // Pro mode adds what we sent the session.
    expect(items(entries, { pro: true }).map((i) => i.kind)).toContain('prompt');
  });

  it('浏览器工具写成人话，带上打开的地址或输入的文字', () => {
    const entries = [
      call('b1', 'agent-workflow_browser_open', { url: '/orders' }),
      result('b1', 'agent-workflow_browser_open', 'completed'),
      call('b2', 'agent-workflow_browser_type', { ref: 'e3', text: 'R-1001' }),
      result('b2', 'agent-workflow_browser_type', 'completed'),
      call('b3', 'agent-workflow_browser_click', { ref: 'e4' }),
      result('b3', 'agent-workflow_browser_click', 'completed'),
    ];
    expect(shown(items(entries))).toEqual(['打开页面 /orders [ok]', '输入 R-1001 [ok]', '点击 [ok]']);
  });

  it('运行中最后一段思考或正文正在写；最后是权限请求时在等待', () => {
    expect(shown(items([part('text', 'a'), part('reasoning', 'b')]))).toEqual(['a', 'thinking 1s ▍: b']);
    expect(shown(items([part('reasoning', 'b'), part('text', 'a')]))).toEqual(['thinking 1s: b', 'a▍']);
    const ask: TranscriptEntry = {
      seq: ++seq,
      ts: 0,
      kind: TranscriptEntryKind.Permission,
      data: { permissionId: 'q', permission: 'bash', patterns: ['rm *'] },
    };
    expect(shown(items([ask], { ended: true }))).toEqual(['wait bash']);
  });

  it('会话因权限或提问停下等你时（权限之后后端追加 awaiting_input），那一条显示在等待', () => {
    const ask: TranscriptEntry = {
      seq: ++seq,
      ts: 0,
      kind: TranscriptEntryKind.Permission,
      data: { permissionId: 'q', permission: 'bash', patterns: ['rm *'] },
    };
    const awaiting: TranscriptEntry = {
      seq: ++seq,
      ts: 0,
      kind: TranscriptEntryKind.System,
      data: { event: TranscriptSystemEvent.AwaitingInput },
    };
    // The permission line itself says what it waits for; the notice is not repeated.
    expect(shown(items([part('text', 'a'), ask, awaiting]))).toEqual(['a', 'wait bash (waiting)']);
    // A blocking question: the notice says the session waits for you.
    const question = call('q1', 'agent-workflow_ask_user', { question: '哪个环境？', blocking: true });
    expect(shown(items([question, awaiting]))).toEqual(['向你提问 [running]', 'notice awaiting_input (waiting)']);
    // Answered: the session goes on, nothing waits any more.
    expect(shown(items([ask, awaiting, part('text', 'b')]))).toEqual(['wait bash', 'notice awaiting_input', 'b▍']);
  });

  it('结束后连续 3 个及以上的动作折叠成组，没有结果的调用为已中断', () => {
    const entries = [
      ...read('a'),
      ...read('b'),
      call('c', 'bash', { command: 'pnpm test' }),
      result('c', 'bash', 'error'),
      part('text', '找到了。'),
      ...read('d'),
      ...read('e'),
      call('f', 'grep', { pattern: 'x' }),
    ];
    expect(shown(items(entries, { ended: true }))).toEqual([
      'group: 查看 2 个文件 · 运行 1 条命令 · 1 个失败',
      '找到了。',
      'group: 查看 2 个文件 · 搜索 1 次',
    ]);
    const stopped = items(entries, { ended: true }).at(-1);
    expect(stopped?.kind === 'group' && stopped.actions.at(-1)?.state).toBe('stopped');
    // Running streams are not folded, and two calls in a row never are.
    expect(items(entries).filter((i) => i.kind === 'group')).toHaveLength(0);
    expect(items([...read('g'), ...read('h')], { ended: true }).map((i) => i.kind)).toEqual(['action', 'action']);
  });

  it('Windows 路径也去掉工作区前缀', () => {
    const lines = streamItems([call('c', 'read', { filePath: 'C:\\wt\\T-1\\src\\a.ts' })], {
      directory: 'C:\\wt\\T-1',
      pro: false,
      ended: false,
    });
    expect(shown(lines)).toEqual(['查看 src/a.ts [running]']);
  });
});

describe('lineDelta', () => {
  it('只计首尾相同行之间的增删', () => {
    expect(lineDelta('', 'x\ny\n')).toEqual({ added: 2, removed: 0 });
    expect(lineDelta('a\nb\nc\n', 'a\nc\n')).toEqual({ added: 0, removed: 1 });
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 });
  });
});
