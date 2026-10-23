import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import { createTaskOp, RuntimeStatus, ServerEventType, TaskStatus } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import { implement, type OperationImpl } from '../../core/operations/operations.ts';
import type { TasksService } from '../tasks/index.ts';
import type { AssistantService } from './assistant.service.ts';
import { createTaskFollowupsRepo } from './assistant.tasks.repo.ts';

/** 普通任务只跟进创建它的对话；归属、事件游标与待发消息均在 SQLite 中。 */
export function createTaskRelay(deps: {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  events: EventBus;
  log: Logger;
  tasks: TasksService;
  conversations: AssistantService;
  prompts: Prompts;
}) {
  const { unit, conversations, clock, log } = deps;
  const repo = createTaskFollowupsRepo(deps.db);
  let started = false;

  async function flush(conversationId: string): Promise<void> {
    try {
      await conversations.flush(conversationId);
    } catch (err) {
      // 失败的消息仍在持久化队列，下次重连、启动或用户发送时继续投递。
      log.error({ err, conversationId }, 'task update not sent to assistant');
    }
  }

  function reconcile(taskId?: string): void {
    const recipients = unit.transact(() => {
      const recipients = new Set<string>();
      for (const task of repo.pending(taskId)) {
        if ([TaskStatus.Review, TaskStatus.Failed, TaskStatus.Completed].some((status) => status === task.status)) {
          conversations.queueMessage(
            task.conversationId,
            renderTemplate(deps.prompts[PromptName.AssistantTaskUpdated], {
              snapshot: JSON.stringify(
                {
                  taskId: task.taskId,
                  key: task.key,
                  title: task.title,
                  link: `/tasks/${encodeURIComponent(task.taskId)}`,
                  eventId: task.eventId,
                  eventType: task.eventType,
                  occurredAt: task.occurredAt,
                  status: task.status,
                  failedPhase: task.failedPhase,
                  failure: task.failure,
                  result:
                    task.status === TaskStatus.Failed || task.result === null
                      ? null
                      : {
                          summary: task.result.summary,
                          filesChanged: task.result.filesChanged,
                          insertions: task.result.insertions,
                          deletions: task.result.deletions,
                          checks: task.result.checks,
                          assumptions: task.result.assumptions,
                        },
                  delivery: task.status === TaskStatus.Completed ? task.delivery : null,
                },
                null,
                2,
              ),
            }),
          );
          recipients.add(task.conversationId);
        }
        repo.acknowledge(task.taskId, task.eventId);
      }
      return recipients;
    });
    if (started) for (const id of recipients) void flush(id);
  }

  deps.events.subscribe((event) => {
    if (event.type === ServerEventType.TaskUpdated) reconcile(event.data.id);
    if (started && event.type === ServerEventType.RuntimeUpdated && event.data.status === RuntimeStatus.Ready) {
      for (const id of repo.conversationIds()) void flush(id);
    }
  });
  // 不依赖进程上次成功收到内存事件；停机期间的旧状态以最新真实状态为准。
  reconcile();

  return {
    async start(): Promise<void> {
      started = true;
      await Promise.all(repo.conversationIds().map(flush));
    },
    async run(conversationId: string, impl: OperationImpl, input: unknown): Promise<unknown> {
      if (impl.contract.id !== createTaskOp.id) return impl.run(input);
      return implement(createTaskOp, (request) =>
        deps.tasks.create(request, (taskId) => {
          conversations.get(conversationId);
          repo.insert(taskId, conversationId, clock.now());
        }),
      ).run(input);
    },
  };
}
export type TaskRelay = ReturnType<typeof createTaskRelay>;
