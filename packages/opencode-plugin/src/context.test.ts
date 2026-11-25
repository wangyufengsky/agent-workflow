import type { Hooks } from '@opencode-ai/plugin';
import { expect, it } from 'vitest';
import { projectHistory } from './context.ts';

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
    state: { output: expect.stringMatching(/a.*pa.*large.txt/) },
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
