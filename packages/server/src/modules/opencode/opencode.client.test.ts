import { ErrorCode } from '@aw/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createRuntimeClient } from './opencode.client.ts';
import { type OpencodeEvent, OpencodeEventType } from './opencode.events.ts';
import type { OpencodeRuntime } from './opencode.runtime.ts';

const idle = (sessionID: string) => ({
  directory: '/tmp/aw-repo',
  payload: { id: `evt_${sessionID}`, type: 'session.idle', properties: { sessionID } },
});

describe('opencode 事件分发（D70）', () => {
  it('一个订阅者处理某个事件出错：按 error 记录（带堆栈），其他订阅者与之后的事件照常处理', () => {
    let pump: ((raw: unknown) => void) | undefined;
    const runtime = {
      onEvent: (listener: (raw: unknown) => void) => {
        pump = listener;
        return () => undefined;
      },
      onLost: () => () => undefined,
    } as unknown as OpencodeRuntime;
    const lines: Array<{ level: number; msg: string; err?: { stack: string }; sessionId?: string }> = [];
    const log = pino({ level: 'info' }, { write: (line: string) => void lines.push(JSON.parse(line)) });
    const client = createRuntimeClient(runtime, log);
    const seen: OpencodeEvent[] = [];
    client.subscribe((event) => {
      if (event.type === OpencodeEventType.Idle && event.sessionId === 'ses_broken') throw new Error('handler bug');
    });
    client.subscribe((event) => seen.push(event));

    pump?.(idle('ses_broken'));
    pump?.(idle('ses_other'));

    expect(seen.map((e) => (e.type === OpencodeEventType.Idle ? e.sessionId : e.type))).toEqual([
      'ses_broken',
      'ses_other',
    ]);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'opencode event handler failed',
        sessionId: 'ses_broken',
        err: expect.objectContaining({ stack: expect.stringContaining('handler bug') }),
      }),
    ]);
  });
});

describe('opencode 会话删除错误映射', () => {
  it.each([
    ['网络故障', new Error('connection refused')],
    [
      '服务端故障',
      new Error('server failed', {
        cause: { status: 500, body: { name: 'NotFoundError', data: { message: 'failed' } } },
      }),
    ],
    [
      '其他 404',
      new Error('route missing', {
        cause: { status: 404, body: { name: 'RouteNotFoundError', data: { message: 'missing' } } },
      }),
    ],
    ['未识别的响应', new Error('unexpected error', { cause: { status: 404, body: { name: 'NotFoundError' } } })],
  ])('%s 不能被当作已经删除，仍向调用方报错', async (_label, error) => {
    const runtime = {
      onEvent: () => () => undefined,
      onLost: () => () => undefined,
      sdk: () => ({
        session: {
          delete: async () => {
            throw error;
          },
        },
      }),
    } as unknown as OpencodeRuntime;
    const client = createRuntimeClient(runtime, pino({ level: 'silent' }));
    await expect(client.deleteSession({ sessionId: 'ses_missing', directory: '/tmp/aw-repo' })).rejects.toMatchObject({
      code: ErrorCode.OpencodeRequestFailed,
      details: { operation: 'session.delete', error: error.message },
    });
  });
});

describe('权限失效的边界识别', () => {
  it.each([
    { status: 404, body: { _tag: 'PermissionNotFoundError', requestID: 'per_other', message: 'missing' } },
    { status: 404, body: { name: 'NotFoundError', data: { message: 'missing route' } } },
    { status: 500, body: { _tag: 'PermissionNotFoundError', requestID: 'per_1', message: 'failed' } },
    undefined,
  ])('非目标权限的明确 404 不得当作失效清理：%j', async (cause) => {
    const runtime = {
      onEvent: () => () => undefined,
      onLost: () => () => undefined,
      sdk: () => ({
        permission: {
          reply: async () => {
            throw new Error('request failed', { cause });
          },
        },
      }),
    } as unknown as OpencodeRuntime;
    await expect(
      createRuntimeClient(runtime, pino({ level: 'silent' })).replyPermission({
        permissionId: 'per_1',
        directory: '/tmp/aw-repo',
        reply: 'always',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.OpencodeRequestFailed });
  });
});

it('Recall 仅返回指定消息下已完成、无附件的工具文本', async () => {
  const ref = { sessionID: 'ses_owner', messageID: 'msg_source' };
  const completed = { status: 'completed', output: 'evidence' };
  const parts = [
    { id: 'prt_ok', type: 'tool', state: completed },
    { id: 'prt_text', type: 'text', text: 'assistant text' },
    { id: 'prt_attachment', type: 'tool', state: { ...completed, attachments: [{ type: 'file' }] } },
    { id: 'prt_failed', type: 'tool', state: { status: 'error', error: 'read failed' } },
  ].map((part) => ({ ...ref, ...part }));
  const runtime = {
    onEvent: () => () => undefined,
    onLost: () => () => undefined,
    sdk: () => ({
      session: {
        message: async () => ({
          data: { info: { id: ref.messageID, sessionID: ref.sessionID, role: 'assistant' }, parts },
        }),
      },
    }),
  } as unknown as OpencodeRuntime;
  const client = createRuntimeClient(runtime, pino({ level: 'silent' }));
  const read = (partId: string) =>
    client.readToolOutput({ sessionId: ref.sessionID, messageId: ref.messageID, directory: '/repo', partId });
  expect(await read('prt_ok')).toBe('evidence');
  for (const id of ['prt_text', 'prt_attachment', 'prt_failed']) expect(await read(id)).toBeUndefined();
});
