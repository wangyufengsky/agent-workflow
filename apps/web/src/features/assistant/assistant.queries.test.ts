import type { AssistantConfirmationDTO, AssistantConversationDTO } from '@aw/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../api/query-keys.ts';
import { updateConfirmation, updateConversation } from './assistant.queries.ts';

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

describe('assistant.updated 更新对话列表缓存', () => {
  it('首次读取还在进行时到达的「处理完毕」不会被那次读取中仍在处理的状态覆盖', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const conversation = (busy: boolean) => ({ id: 'v1', busy, updatedAt: 1 }) as unknown as AssistantConversationDTO;
    let answerFirstRead: (items: AssistantConversationDTO[]) => void = () => {};
    let reads = 0;
    const observer = new QueryObserver(qc, {
      queryKey: queryKeys.assistantConversations,
      queryFn: () =>
        ++reads === 1
          ? new Promise<AssistantConversationDTO[]>((resolve) => {
              answerFirstRead = resolve;
            })
          : Promise.resolve([conversation(false)]),
    });
    const unsubscribe = observer.subscribe(() => {});
    const updated = updateConversation(qc, conversation(false));
    answerFirstRead([conversation(true)]);
    await updated;
    expect(qc.getQueryData(queryKeys.assistantConversations)).toEqual([conversation(false)]);
    unsubscribe();
  });
});
