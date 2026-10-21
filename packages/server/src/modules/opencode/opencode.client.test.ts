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
