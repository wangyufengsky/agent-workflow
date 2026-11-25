import {
  AppError,
  budgetSnapshotSchema,
  type ContextBudgetSnapshot,
  ErrorCode,
  type ProjectionReceipt,
  projectionReceiptSchema,
} from '@aw/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import { hasToken } from '../../core/http/mcp-endpoint.ts';
import type { Logger } from '../../core/logger.ts';

import { OPENCODE_CONTEXT_PATH } from './opencode.config.ts';

import type { createContextSummaries } from './opencode.summaries.ts';

const directoryQuery = z.object({ directory: z.string().min(1), sessionId: z.string().optional() });
const report = budgetSnapshotSchema.omit({ blocked: true }).extend({
  receipt: projectionReceiptSchema,
  directory: z.string(),
  attemptId: z.string(),
  sessionId: z.string(),
  summary: z
    .object({ uptoMessageId: z.string().min(1), source: z.string().min(1), model: z.string().min(1) })
    .optional(),
});

export function createBudgetSnapshots() {
  const values = new Map<string, ContextBudgetSnapshot & { receipt: ProjectionReceipt; attemptId: string }>();
  return {
    get: (id: string) => values.get(id),
    delete: (id: string) => values.delete(id),
    set(id: string, data: ContextBudgetSnapshot & { receipt: ProjectionReceipt; attemptId: string }) {
      values.delete(id);
      values.set(id, data);
      const oldest = values.keys().next().value;
      if (values.size > 64 && oldest !== undefined) values.delete(oldest);
    },
  };
}

/** 插件在抛错前等待登记完成，idle/error 不再通过错误文案猜测阻断原因。 */
export function registerContextRoutes(
  server: FastifyInstance,
  deps: {
    snapshots: ReturnType<typeof createBudgetSnapshots>;
    manage(sessionId: string, model: string): void;
    token: string;
    enabled(): boolean;
    taskAt(path: string): string | undefined;
    owner(sessionId: string, directory: string, taskId: string): string | undefined;
    block(sessionId: string, attemptId: string): void;
    summaries: ReturnType<typeof createContextSummaries>;
    toolBytes(): number;
    log: Logger;
  },
): void {
  // 执行 MCP 的工具定义在注册时固定，首次受管请求才计算体积。
  let toolBytes: number | undefined;
  server.register(
    async (routes) => {
      routes.addHook('onRequest', async (req) => {
        if (!hasToken(req, deps.token)) throw new AppError(ErrorCode.Unauthorized, 'Invalid bridge token');
      });
      routes.get('/scope', async (req) => {
        const { directory, sessionId } = parseInput(directoryQuery, req.query);
        const taskId = deps.taskAt(directory);
        const enabled = !!taskId && deps.enabled();
        if (!sessionId) return { enabled };
        const attemptId = taskId && deps.owner(sessionId, directory, taskId);
        if (!attemptId) return { enabled, attemptId: null };
        toolBytes ??= deps.toolBytes();
        return { enabled, attemptId, toolBytes, ...(enabled && { summary: deps.summaries.get(sessionId) }) };
      });
      routes.post('/budget', async (req) => {
        const { directory, summary, receipt, ...data } = parseInput(report, req.body);
        const taskId = deps.taskAt(directory);
        if (!taskId || deps.owner(data.sessionId, directory, taskId) !== data.attemptId) return { blocked: true };
        // 开关可在消息转换与最后一次预算检查之间关闭。
        const effective = deps.enabled() ? data.after : data.before;
        const overBudgetWarning = data.limit !== null && effective > data.limit;
        const blocked = !deps.enabled() && overBudgetWarning;
        if (deps.enabled()) deps.manage(data.sessionId, data.model);
        deps.snapshots.set(data.sessionId, { ...data, receipt, overBudgetWarning, blocked });
        if (blocked) deps.block(data.sessionId, data.attemptId);
        else if (summary && deps.enabled())
          void deps.summaries.generate({
            ...summary,
            sessionId: data.sessionId,
            attemptId: data.attemptId,
            taskId,
            directory,
          });
        deps.log.info({ ...data, effective, overBudgetWarning, blocked }, 'context budget');
        return { blocked };
      });
    },
    { prefix: OPENCODE_CONTEXT_PATH },
  );
}
