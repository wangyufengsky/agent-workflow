import {
  AppError,
  AttachmentSource,
  AttemptKind,
  AttemptStatus,
  type ConventionEvidenceRequest,
  ErrorCode,
  errorInfoSchema,
  NodeEvent,
  TaskEvent,
  TaskEventEntity,
} from '@aw/shared';
import { z } from 'zod';
import { listTaskEvents } from '../timeline/index.ts';
import type { createTaskReview } from './tasks.review.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const EVIDENCE_TEXT_LIMIT = 8000;
/** 预览文本与传给任务的快照一致。 */
function snapshotText(text: string): string {
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[已隐藏]')
    .replace(/\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]+/gi, '[已隐藏]');
  return redacted.length > EVIDENCE_TEXT_LIMIT
    ? `${redacted.slice(0, EVIDENCE_TEXT_LIMIT)}\n[内容过长，已截断]`
    : redacted;
}

const checkFacts = z.object({ checks: z.array(z.object({ kind: z.string(), passed: z.boolean() })) });
function failureFacts(payload: Record<string, unknown> | null): string {
  if (payload === null) return '原事件未保存失败详情，请打开来源查看；不要推测原因。';
  const checks = checkFacts.safeParse(payload);
  if (checks.success && checks.data.checks.length > 0) return JSON.stringify(checks.data);
  const error = errorInfoSchema.safeParse(payload.error);
  if (error.success) return `错误代码：${error.data.code}`;
  return '原事件未保存失败详情，请打开来源查看；不要推测原因。';
}

/** 发起任务前，先按项目核对并封存用户选中的资料。 */
export function createConventionEvidence(
  deps: TasksServiceDeps,
  state: TaskState,
  review: ReturnType<typeof createTaskReview>,
) {
  const { db } = deps;
  return async function previewConventionEvidence(input: ConventionEvidenceRequest) {
    deps.projects.getRecord(input.id);
    const refs = [
      ...input.failures.map((f) => `f:${f.taskId}:${f.eventId}`),
      ...input.reviews.map((r) => `r:${r.taskId}:${r.commentId}`),
    ];
    if (new Set(refs).size !== refs.length) throw new AppError(ErrorCode.ValidationFailed, 'Duplicate evidence');
    const taskIds = [...new Set([...input.failures, ...input.reviews].map((r) => r.taskId))];
    for (const id of taskIds) {
      if (state.get(id).projectId !== input.id)
        throw new AppError(ErrorCode.ValidationFailed, 'Evidence belongs to another project');
    }
    const suggestions: {
      text: string;
      applicability: string;
      taskId: string;
      eventId: number | null;
      commentId: string | null;
      nodeId: string | null;
      attemptId: string | null;
      sourceUrl: string | null;
    }[] = [];
    const failures = input.failures.map(({ taskId, eventId }) => {
      const timeline = listTaskEvents(db, taskId, 0);
      const event = timeline.find((e) => e.id === eventId);
      const isFailure =
        event !== undefined &&
        ((event.entity === TaskEventEntity.Task && event.type === TaskEvent.Fail) ||
          (event.entity === TaskEventEntity.Node &&
            [NodeEvent.ChecksFailed, NodeEvent.CheckUnrunnable, NodeEvent.AttemptFailed, NodeEvent.Reject].some(
              (type) => type === event.type,
            )) ||
          (event.entity === TaskEventEntity.Attempt && event.toStatus === AttemptStatus.Failed));
      if (!isFailure || event === undefined) throw new AppError(ErrorCode.ValidationFailed, 'Failure event not found');
      const task = state.get(taskId);
      const attempts = deps.attempts.listByTask(taskId);
      const direct =
        event.entity === TaskEventEntity.Attempt ? attempts.find((a) => a.id === event.entityId) : undefined;
      const cycleStart =
        event.entity === TaskEventEntity.Node &&
        [NodeEvent.ChecksFailed, NodeEvent.CheckUnrunnable, NodeEvent.AttemptFailed].some((type) => type === event.type)
          ? timeline
              .filter(
                (e) =>
                  e.id < event.id &&
                  e.entity === TaskEventEntity.Node &&
                  e.entityId === event.entityId &&
                  (e.type === NodeEvent.Dispatch || e.type === NodeEvent.Recheck),
              )
              .at(-1)?.id
          : undefined;
      const matchingEvent =
        cycleStart === undefined
          ? undefined
          : timeline
              .filter(
                (e) =>
                  e.id > cycleStart &&
                  e.id < event.id &&
                  e.entity === TaskEventEntity.Attempt &&
                  (event.type === NodeEvent.AttemptFailed
                    ? e.toStatus === AttemptStatus.Failed
                    : e.toStatus === AttemptStatus.Succeeded) &&
                  attempts.some(
                    (a) => a.id === e.entityId && a.nodeId === event.entityId && a.kind === AttemptKind.Execute,
                  ),
              )
              .at(-1);
      const linked =
        direct ?? (matchingEvent === undefined ? undefined : attempts.find((a) => a.id === matchingEvent.entityId));
      const suggestion =
        event.type === NodeEvent.ChecksFailed || event.type === NodeEvent.CheckUnrunnable
          ? '提交前运行适用的项目检查，并处理检查未通过或无法启动的问题。'
          : event.type === NodeEvent.Reject
            ? '交付前对照验收要求检查结果，处理不符合的部分。'
            : '遇到执行失败时先查看对应步骤的错误证据，再判断是否需要调整项目配置。';
      suggestions.push({
        text: suggestion,
        applicability: '发生同类问题的任务；先核对项目现状',
        taskId,
        eventId,
        commentId: null,
        nodeId: event.entity === TaskEventEntity.Node ? event.entityId : (linked?.nodeId ?? null),
        attemptId: linked?.id ?? null,
        sourceUrl: null,
      });
      return `任务 ${task.key} · ${task.title} (${taskId})\n事件 ${event.id} · ${event.type} · ${new Date(event.createdAt).toISOString()}\n${failureFacts(event.payload)}`;
    });
    const reviewTasks = [...new Set(input.reviews.map((r) => r.taskId))];
    const fetched = await Promise.all(reviewTasks.map(async (id) => [id, await review.reviewComments(id)] as const));
    const byTask = new Map(fetched);
    const reviews = input.reviews.map(({ taskId, commentId }) => {
      const comment = byTask.get(taskId)?.items.find((c) => c.id === commentId);
      if (comment === undefined) throw new AppError(ErrorCode.ValidationFailed, 'Review comment not found');
      const task = state.get(taskId);
      const first = comment.messages[0];
      if (first !== undefined)
        suggestions.push({
          text: snapshotText(first.body).slice(0, 1000),
          applicability: '仅在审查意见具有可复用性时适用；请核对并改写',
          taskId,
          eventId: null,
          commentId,
          nodeId: null,
          attemptId: null,
          sourceUrl: comment.url,
        });
      return `任务 ${task.key} · ${task.title} (${taskId})\n评论 ${comment.id} · ${comment.url}\n${snapshotText(comment.messages.map((m) => `${m.author}: ${m.body}`).join('\n'))}`;
    });
    const text = [
      '项目约定资料快照：仅以所选事实作为线索，核对项目现状与适用条件；一次性要求不应写成通用规则。每条资料最多 8000 字，常见凭据格式已隐藏；请以来源为准。',
      ...failures.map((f) => `失败记录\n${f}`),
      ...reviews.map((r) => `审查意见\n${r}`),
    ].join('\n\n');
    const attachment = await deps.attachments.saveConventionEvidence(
      { kind: AttachmentSource.ConventionEvidence, projectId: input.id, readAt: deps.clock.now() },
      text,
    );
    return { attachmentId: attachment.id, text, suggestions };
  };
}
