import { MCP_TOOL_PREFIX, McpToolName } from '@aw/shared';
import type { Hooks } from '@opencode-ai/plugin';
import { expect, it } from 'vitest';
import { historyBytes } from './context.ts';
import { applySummary, freezePrefix, projectHistory } from './projection.ts';

type Messages = Parameters<NonNullable<Hooks['experimental.chat.messages.transform']>>[1]['messages'];
function read(id: string, path = '/repo/large.txt', loaded: string[] = [], state: Record<string, unknown> = {}) {
  const metadata = { loaded, display: { type: 'file', path } };
  return {
    info: { id, role: 'assistant', sessionID: 's', time: { completed: 1 } },
    parts: [
      {
        type: 'tool',
        tool: 'read',
        id: `p${id}`,
        messageID: id,
        sessionID: 's',
        callID: `c${id}`,
        state: {
          status: 'completed',
          input: { filePath: path },
          metadata,
          output: 'evidence'.repeat(300),
          time: { start: 0, end: 1 },
          ...state,
        },
      },
    ],
  };
}
it('只投影早期普通文件正文，保留标识、最新批次和局部规则', () => {
  const source = [read('a'), read('b', '/repo/AGENTS.md'), read('c', '/repo/x', ['/repo/CLAUDE.md']), read('d')];
  const original = structuredClone(source);
  const projected = projectHistory(source as unknown as Messages);
  expect(projected.slice(1)).toEqual(original.slice(1));
  expect(projected[0]?.parts[0]).toMatchObject({
    callID: 'ca',
    state: { output: `[AW read messageId=a partId=pa path=/repo/large.txt → ${MCP_TOOL_PREFIX}${McpToolName.Recall}]` },
  });
  expect(source).toEqual(original);
});

it('规则提醒、失败调用、附件与未完成调用所在的证据保持原样', () => {
  const source = [
    read('reminder', undefined, [], { output: `<system-reminder>${'rule'.repeat(500)}` }),
    read('failed', undefined, [], { status: 'error', error: 'read failed' }),
    read('attachment', undefined, [], { attachments: [{ mime: 'image/png' }] }),
    read('pending', undefined, [], { status: 'running' }),
    read('latest'),
  ];
  expect(projectHistory(source as unknown as Messages)).toEqual(source);
});

it('按数组中的终点替换完整前缀，保留规则、新指令和最新工具批次，失效终点回退', () => {
  const user = (id: string) => ({
    info: { role: 'user', id, sessionID: 's' },
    parts: [{ id: `p${id}`, type: 'text', sessionID: 's', messageID: id, text: id }],
  });
  const evidence = read('z');
  for (const part of evidence.parts) part.tool = 'grep';
  const root = user('original goal');
  const rule = read('rules', '/repo/AGENTS.md');
  const latest = read('b');
  const during = [root, evidence, rule, latest] as unknown as Messages;
  const frozen = freezePrefix(projectHistory(during));
  expect(frozen?.uptoMessageId).toBe('z');
  expect(frozen?.source).toContain('original goal');
  expect(frozen?.source).toContain('"partId":"pz"');
  const summary = { uptoMessageId: 'z', summaryText: 'Found the evidence' };
  const newer = user('new instruction');
  const tail = read('a');
  const history = projectHistory([...during, newer, tail] as unknown as Messages);
  const projected = applySummary(history, summary);
  expect(projected[0]).toEqual(root);
  expect(projected[1]?.parts).toMatchObject([{ type: 'text', text: expect.stringContaining(summary.summaryText) }]);
  expect(projected.slice(2)).toEqual(history.slice(2));
  expect(applySummary(history, { ...summary, uptoMessageId: 'absent' })).toBe(history);
  expect(applySummary(history, { ...summary, uptoMessageId: 'a' })).toBe(history);
  expect(applySummary(projectHistory(during), summary)[0]).toEqual(root);
});

it('后一轮摘要继承已发布摘要并包含新增证据，只有原摘要时不重跑', () => {
  const tool = (id: string) => {
    const m = read(id);
    for (const p of m.parts) p.tool = 'grep';
    return m;
  };
  const history = [tool('z'), tool('b'), tool('a')] as unknown as Messages;
  const prior = { uptoMessageId: 'z', summaryText: 'Previous conclusion' };
  const projected = applySummary(history, prior);
  const next = freezePrefix(projected, prior.uptoMessageId);
  expect(next?.uptoMessageId).toBe('b');
  expect(next?.source).toContain('Previous conclusion');
  expect(next?.source).toContain('"partId":"pb"');
  expect(next?.source).not.toContain('"partId":"pz"');
  expect(freezePrefix(applySummary(history.slice(0, 2), prior), prior.uptoMessageId)).toBeUndefined();
});

it('内联图片按张估算，直接附件和工具截图的预算独立于 base64 长度', () => {
  const estimate = (encoded: string, tool: boolean, count = 1, output = '') => {
    const image = { type: 'file', mime: 'image/png', url: `data:image/png;base64,${encoded}` };
    const files = Array.from({ length: count }, () => image);
    const parts = tool ? read('shot', undefined, [], { attachments: files, output }).parts : files;
    return historyBytes([{ info: { role: 'user' }, parts }] as unknown as Messages);
  };
  for (const tool of [true, false]) {
    const one = estimate('AAAA', tool);
    expect(estimate('AAAA'.repeat(102400), tool)).toBe(one);
    expect(estimate('AAAA', tool, 2) - one).toBeGreaterThan(100);
  }
  expect(estimate('AAAA', true, 1, 'a'.repeat(10000)) - estimate('AAAA', true)).toBe(10000);
});
