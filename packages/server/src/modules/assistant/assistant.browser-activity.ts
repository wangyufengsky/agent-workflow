import { type AssistantBrowserActivity, assistantBrowserActivitySchema, ServerEventType } from '@aw/shared';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { EventBus } from '../../core/event-bus.ts';
import { assistantBrowserActivityTable as activity } from './assistant.browser-activity.table.ts';
import { assistantConversationsTable as conversations } from './assistant.table.ts';

const MAX_ACTIVITY = 100;

export function createBrowserActivity(db: Db, clock: Clock, events: EventBus) {
  const updated = (conversationId: string) =>
    events.publish({ type: ServerEventType.AssistantBrowserUpdated, data: { conversationId } });
  return {
    updated,
    list(conversationId: string): AssistantBrowserActivity[] {
      return db
        .select()
        .from(activity)
        .where(eq(activity.conversationId, conversationId))
        .orderBy(desc(activity.id))
        .limit(MAX_ACTIVITY)
        .all()
        .map(({ id, record, at }) => assistantBrowserActivitySchema.parse({ ...JSON.parse(record), id, at }));
    },
    record(conversationId: string, record: Omit<AssistantBrowserActivity, 'id' | 'at'>) {
      // 操作结束时，对话可能已被用户删除。
      if (
        db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).get() ===
        undefined
      )
        return;
      db.insert(activity)
        .values({ conversationId, record: JSON.stringify(record), at: clock.now() })
        .run();
      const excess = db
        .select({ id: activity.id })
        .from(activity)
        .where(eq(activity.conversationId, conversationId))
        .orderBy(desc(activity.id))
        .limit(1)
        .offset(MAX_ACTIVITY)
        .get();
      if (excess !== undefined)
        db.delete(activity)
          .where(and(eq(activity.conversationId, conversationId), lte(activity.id, excess.id)))
          .run();
      updated(conversationId);
    },
  };
}
