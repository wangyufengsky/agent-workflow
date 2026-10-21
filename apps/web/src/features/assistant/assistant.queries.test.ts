import type { AssistantConfirmationDTO } from '@aw/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../api/query-keys.ts';
import { updateConfirmation } from './assistant.queries.ts';

const card = { id: 'c1', conversationId: 'v1', createdAt: 1 } as unknown as AssistantConfirmationDTO;

describe('assistant.confirmation 更新确认卡片缓存', () => {
  it('首次读取还在进行时到达的新卡片不会被那次（更早的）读取结果覆盖', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let answerFirstRead: (items: AssistantConfirmationDTO[]) => void = () => {};
    let reads = 0;
    const observer = new QueryObserver(qc, {
      queryKey: queryKeys.assistantConfirmations('v1'),
      // The first read is answered late, from before the card existed; later reads include it.
      queryFn: () =>
        ++reads === 1
          ? new Promise<AssistantConfirmationDTO[]>((resolve) => {
              answerFirstRead = resolve;
            })
          : Promise.resolve([card]),
    });
    const unsubscribe = observer.subscribe(() => {});
    const updated = updateConfirmation(qc, card);
    answerFirstRead([]);
    await updated;
    expect(qc.getQueryData(queryKeys.assistantConfirmations('v1'))).toEqual([card]);
    unsubscribe();
  });
});
