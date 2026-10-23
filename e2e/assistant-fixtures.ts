import { test as base, expect, type Response } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';

/** 只回收当前页面通过创建接口获得的聊天，不影响共享后端里其他用例的历史。 */
export const test = base.extend<{ ownedAssistantConversations: undefined }>({
  ownedAssistantConversations: [
    async ({ page, request }, use) => {
      const owned = new Set<string>();
      const captured: Promise<void>[] = [];
      const capture = (response: Response) => {
        if (
          response.request().method() !== 'POST' ||
          !new URL(response.url()).pathname.endsWith('/assistant/conversations') ||
          !response.ok()
        )
          return;
        captured.push(
          response.json().then((conversation: { id: string }) => {
            owned.add(conversation.id);
          }),
        );
      };
      page.on('response', capture);
      try {
        await use(undefined);
      } finally {
        page.off('response', capture);
        await Promise.all(captured);
        for (const id of owned) {
          const response = await request.get(`${API_BASE}/assistant/conversations/${id}`, { headers: AUTH });
          if (response.status() === 404) continue;
          expect(response.ok()).toBe(true);
          const conversation: { busy: boolean } = await response.json();
          if (conversation.busy) {
            const stopped = await request.post(`${API_BASE}/assistant/conversations/${id}/abort`, {
              headers: AUTH,
              data: {},
            });
            expect(stopped.ok()).toBe(true);
          }
          const removed = await request.delete(`${API_BASE}/assistant/conversations/${id}`, { headers: AUTH });
          expect(removed.ok()).toBe(true);
        }
      }
    },
    { auto: true },
  ],
});
