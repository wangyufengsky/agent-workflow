import { randomUUID } from 'node:crypto';
import {
  AppError,
  BLOCKING_INBOX_KINDS,
  ErrorCode,
  InboxEvent,
  type InboxItemDTO,
  type InboxItemOf,
  InboxKind,
  InboxStatus,
  inboxMachine,
  type ListInboxQuery,
  NON_BLOCKING_INBOX_KINDS,
  type PermissionDecision,
  ServerEventType,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import { createInboxRepo, type InboxScope } from './inbox.repo.ts';

export type InboxServiceDeps = { db: Db; unit: UnitOfWork; clock: Clock; log: Logger };

/** What a new item needs; the service adds id, status and timestamps. */
export type NewInboxItem = {
  [K in InboxKind]: Pick<InboxItemOf<K>, 'kind' | 'taskId' | 'nodeId' | 'attemptId' | 'title' | 'payload'>;
}[InboxKind];

/** Only these kinds may be dismissed by the user (11 §7); the others need a decision. */
const USER_DISMISSABLE: readonly InboxKind[] = [InboxKind.Failure, InboxKind.Delivery, InboxKind.ScheduleFailure];

/**
 * 「需要你处理」records (10 §inbox_items) and their state machine (09 §8). Acting on a decision (sending an answer,
 * replying to opencode, confirming a plan …) belongs to the module owning that action, which then resolves the item.
 */
export function createInboxService({ db, unit, clock, log }: InboxServiceDeps) {
  const repo = createInboxRepo(db);

  function get(id: string): InboxItemDTO {
    const item = repo.find(id);
    if (item === undefined) throw new AppError(ErrorCode.InboxItemNotFound, `Inbox item ${id} not found`, { id });
    return item;
  }

  function publish(item: InboxItemDTO): void {
    unit.publish({ type: ServerEventType.InboxUpdated, data: { item, blockingCount: repo.countBlocking() } });
  }

  function close(item: InboxItemDTO, event: InboxEvent, response?: unknown): InboxItemDTO {
    const to = transition(inboxMachine, item.status, event);
    repo.close(item.id, to, { resolvedAt: clock.now(), ...(response === undefined ? {} : { response }) });
    const closed = get(item.id);
    log.info({ itemId: item.id, kind: item.kind, taskId: item.taskId, to }, 'inbox item closed');
    publish(closed);
    return closed;
  }

  function insert(input: NewInboxItem, status: InboxStatus, response: unknown): InboxItemDTO {
    const now = clock.now();
    const id = randomUUID();
    repo.insert({
      ...input,
      id,
      status,
      response,
      createdAt: now,
      resolvedAt: status === InboxStatus.Open ? null : now,
    });
    const item = get(id);
    log.info({ itemId: id, kind: item.kind, taskId: item.taskId }, 'inbox item created');
    publish(item);
    return item;
  }

  return {
    get,
    list: (scope: InboxScope, status?: InboxStatus): InboxItemDTO[] => repo.list(scope, status),
    listOpen: (scope: InboxScope): InboxItemDTO[] => repo.list(scope, InboxStatus.Open),
    /** A page of the「需要你处理」list (11 §7), newest first. */
    page({ status, taskId, blocking, limit, cursor }: ListInboxQuery): {
      items: InboxItemDTO[];
      nextCursor: string | null;
    } {
      const at = cursor === undefined ? -1 : cursor.indexOf('.');
      const after =
        cursor === undefined ? undefined : { createdAt: Number(cursor.slice(0, at)), id: cursor.slice(at + 1) };
      const scope = {
        ...(taskId === undefined ? {} : { taskId }),
        ...(blocking === undefined ? {} : { kinds: blocking ? BLOCKING_INBOX_KINDS : NON_BLOCKING_INBOX_KINDS }),
      };
      const rows = repo.page(scope, status, after, limit + 1);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > limit && last !== undefined ? `${last.createdAt}.${last.id}` : null,
      };
    },
    countBlocking: (): number => repo.countBlocking(),

    create: (input: NewInboxItem): InboxItemDTO => insert(input, InboxStatus.Open, null),

    /** A record of something decided without the user, e.g. an assumption the model made (09 §8). */
    createResolved: (input: NewInboxItem, response: unknown): InboxItemDTO =>
      insert(input, InboxStatus.Resolved, response),

    /** The open item; a closed one cannot be acted on any more (INBOX_ITEM_CLOSED). */
    requireOpen(id: string): InboxItemDTO {
      const item = get(id);
      if (item.status !== InboxStatus.Open) {
        throw new AppError(ErrorCode.InboxItemClosed, `Inbox item ${id} is ${item.status}`, {
          id,
          status: item.status,
        });
      }
      return item;
    },

    resolve: (item: InboxItemDTO, response: unknown): InboxItemDTO => close(item, InboxEvent.Resolve, response),

    /** 原生答复事件和 HTTP 返回都可能先到；只关闭对应的未处理请求。失效不等于批准。 */
    completePermission(attemptId: string, permissionId: string, decision: PermissionDecision | undefined): void {
      const item = repo
        .list({ attemptId, kind: InboxKind.Permission }, InboxStatus.Open)
        .find((i) => i.kind === InboxKind.Permission && i.payload.opencodePermissionId === permissionId);
      if (item === undefined) return;
      if (decision === undefined) close(item, InboxEvent.Dismiss);
      else close(item, InboxEvent.Resolve, { decision });
    },

    /** Resolves the open items of a scope, e.g. the plan item once the plan is confirmed through the task page. */
    resolveOpen(scope: InboxScope, response: unknown): void {
      for (const item of repo.list(scope, InboxStatus.Open)) close(item, InboxEvent.Resolve, response);
    },

    /** The user dismisses a failure, delivery or schedule failure item. */
    dismiss(id: string): InboxItemDTO {
      const item = get(id);
      if (!USER_DISMISSABLE.includes(item.kind)) {
        throw new AppError(ErrorCode.ValidationFailed, `${item.kind} items need a decision and cannot be dismissed`, {
          id,
          kind: item.kind,
        });
      }
      return close(item, InboxEvent.Dismiss);
    },

    /** Items lose their meaning when their task, node or attempt ends (09 §8). */
    dismissOpen(scope: InboxScope): void {
      for (const item of repo.list(scope, InboxStatus.Open)) close(item, InboxEvent.Dismiss);
    },
  };
}
export type InboxService = ReturnType<typeof createInboxService>;
