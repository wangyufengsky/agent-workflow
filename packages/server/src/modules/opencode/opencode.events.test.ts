import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpencodeEventType as E, parseGlobalEvent, ToolCallStatus } from './opencode.events.ts';

/** Global events recorded from opencode 1.19.0: write a file, run `ls` after a permission prompt, answer. */
const recorded: unknown[] = JSON.parse(
  readFileSync(new URL('../../../test/fixtures/opencode-1.19.0-events.json', import.meta.url), 'utf8'),
);
const parsed = recorded.map(parseGlobalEvent).filter((e) => e !== undefined);

describe('opencode 全局事件解析', () => {
  it('从实测事件流得到消息、文本、工具、权限、用量与空闲事件', () => {
    expect(new Set(parsed.map((e) => e.type))).toEqual(
      new Set([E.Message, E.Text, E.TextDelta, E.Tool, E.StepFinished, E.PermissionAsked, E.Idle]),
    );
    expect(parsed.at(-1)).toEqual({ type: E.Idle, sessionId: 'ses_eac74a387ffeMgXo9hDGXzyQPQ' });
  });

  it('流式片段拼接后等于完成时的全文', () => {
    const answer = parsed.filter((e) => e.type === E.Text && e.kind === 'text' && e.done).at(-1);
    if (answer?.type !== E.Text) throw new Error('no completed text part');
    const deltas = parsed.filter((e) => e.type === E.TextDelta && e.partId === answer.partId);
    expect(deltas.map((d) => (d.type === E.TextDelta ? d.delta : '')).join('')).toBe(answer.text);
    expect(answer.text).toBe('Created hello.txt with "hi" and listed the directory contents.');
  });

  it('工具调用按状态给出输入与输出', () => {
    const bash = parsed.filter((e) => e.type === E.Tool && e.tool === 'bash');
    expect(bash.map((e) => (e.type === E.Tool ? e.status : undefined))).toEqual([
      ToolCallStatus.Pending,
      ToolCallStatus.Running,
      ToolCallStatus.Running,
      ToolCallStatus.Running,
      ToolCallStatus.Completed,
    ]);
    expect(bash.at(-1)).toMatchObject({ input: { command: 'ls' }, output: 'README.md\nhello.txt\n' });
  });

  it('权限请求带目录与匹配模式', () => {
    expect(parsed.find((e) => e.type === E.PermissionAsked)).toEqual({
      type: E.PermissionAsked,
      sessionId: 'ses_eac74a387ffeMgXo9hDGXzyQPQ',
      directory: '/tmp/aw-repo',
      permissionId: 'per_1538b763f00126bX5oaRtvGt4W',
      messageId: 'msg_1538b72b8001PShaIBPviQmH3V',
      permission: 'bash',
      patterns: ['ls'],
    });
  });

  it('真实用量报告保留消息与步骤标识，供所属轮次匹配和重放去重', () => {
    expect(parsed.find((event) => event.type === E.StepFinished)).toEqual({
      type: E.StepFinished,
      sessionId: 'ses_eac74a387ffeMgXo9hDGXzyQPQ',
      messageId: 'msg_1538b5d19001aSulM6ndvCetJc',
      partId: 'prt_1538b723d001f2I80CqDGxK1Ua',
      tokens: { input: 9736, output: 63 },
      cost: 0,
    });
  });

  it('重试状态与会话错误', () => {
    const retry = parseGlobalEvent({
      directory: '/tmp/aw-repo',
      payload: {
        type: 'session.status',
        properties: { sessionID: 's1', status: { type: 'retry', attempt: 1, message: 'Free usage exceeded', next: 1 } },
      },
    });
    expect(retry).toEqual({ type: E.Retry, sessionId: 's1', message: 'Free usage exceeded' });

    const error = { name: 'APIError', data: { message: 'Bad Gateway', isRetryable: false } };
    const failed = parseGlobalEvent({
      directory: '/tmp/aw-repo',
      payload: { type: 'session.error', properties: { sessionID: 's1', error } },
    });
    expect(failed).toEqual({ type: E.Error, sessionId: 's1', error });
  });

  it('不消费的事件类型返回 undefined，消费的事件结构不符时报错', () => {
    expect(parseGlobalEvent({ directory: '', payload: { type: 'server.heartbeat', properties: {} } })).toBeUndefined();
    expect(() =>
      parseGlobalEvent({ directory: '', payload: { type: 'session.idle', properties: { session: 's1' } } }),
    ).toThrow();
  });
});
