import { expect, it } from 'vitest';
import { activeWindow, type Messages } from './messages.ts';

it('完整原生摘要置于保留尾段之前，未成功的新标记不截断旧窗口', () => {
  const message = (id: string, role = 'user', parts: unknown[] = [], info = {}) => ({
    info: { id, role, ...info },
    parts,
  });
  const source = [
    message('archive'),
    message('tail'),
    message('mark', 'user', [{ type: 'compaction', tail_start_id: 'tail' }]),
    message('summary', 'assistant', [], { summary: true, parentID: 'mark', finish: 'stop' }),
    message('new'),
    message('failed', 'user', [{ type: 'compaction' }]),
    message('error', 'assistant', [], { summary: true, parentID: 'failed', finish: 'error', error: {} }),
  ] as unknown as Messages;
  expect(activeWindow(source).map((m) => m.info.id)).toEqual(['mark', 'summary', 'tail', 'new', 'failed', 'error']);
});
