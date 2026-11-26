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

import { type ContextOwner, ownerLog } from './opencode.context-owner.ts';
import type { createContextSummaries } from './opencode.summaries.ts';

const directoryQuery = z.object({ directory: z.string().min(1), sessionId: z.string().optional() });
const report = budgetSnapshotSchema.omit({ blocked: true }).extend({
  receipt: projectionReceiptSchema,
  directory: z.string(),
  ownerId: z.string(),
  sessionId: z.string(),
  summary: z
    .object({ uptoMessageId: z.string().min(1), source: z.string().min(1), model: z.string().min(1) })
    .optional(),
});

export function createBudgetSnapshots() {
  const values = new Map<string, ContextBudgetSnapshot & { receipt: ProjectionReceipt; ownerId: string }>();
  return {
    get: (id: string) => values.get(id),
    delete: (id: string) => values.delete(id),
    set(id: string, data: ContextBudgetSnapshot & { receipt: ProjectionReceipt; ownerId: string }) {
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
    recallTool(owner: ContextOwner, sessionId: string, directory: string): Promise<string | undefined>;
    snapshots: ReturnType<typeof createBudgetSnapshots>;
    manage(owner: ContextOwner, sessionId: string, model: string): void;
    token: string;
    enabled(): boolean;
    directoryManaged(path: string): boolean;
    owner(sessionId: string, directory: string): ContextOwner | undefined;
    block(owner: ContextOwner, sessionId: string): void;
    summaries: ReturnType<typeof createContextSummaries>;
    toolBytes(execution: boolean): number;
    log: Logger;
  },
): void {
  server.register(
    async (routes) => {
      routes.addHook('onRequest', async (req) => {
        if (!hasToken(req, deps.token)) throw new AppError(ErrorCode.Unauthorized, 'Invalid bridge token');
      });
      routes.get('/scope', async (req) => {
        const { directory, sessionId } = parseInput(directoryQuery, req.query);
        if (!sessionId) return { enabled: deps.enabled() && deps.directoryManaged(directory) };
        const owner = deps.owner(sessionId, directory);
        if (!owner) return { enabled: false, ownerId: null };
        const enabled = deps.enabled();
        const recallTool = enabled ? await deps.recallTool(owner, sessionId, directory) : undefined;
        return {
          enabled,
          kind: owner.kind,
          ownerId: owner.id,
          toolBytes: deps.toolBytes(owner.kind === 'attempt'),
          recallTool,
          ...(recallTool && { summary: deps.summaries.get(sessionId, owner) }),
        };
      });
      routes.post('/budget', async (req) => {
        const { directory, summary, receipt, ...data } = parseInput(report, req.body);
        const owner = deps.owner(data.sessionId, directory);
        if (!owner || owner.id !== data.ownerId) return { blocked: true };
        // 开关可在消息转换与最后一次预算检查之间关闭。
        const enabled = deps.enabled();
        const effective = enabled ? data.after : data.before;
        const overBudgetWarning = data.limit !== null && effective > data.limit;
        const blocked = owner.kind === 'attempt' && !enabled && overBudgetWarning;
        if (enabled) deps.manage(owner, data.sessionId, data.model);
        deps.snapshots.set(data.sessionId, { ...data, receipt, overBudgetWarning, blocked });
        if (blocked) deps.block(owner, data.sessionId);
        else if (summary && enabled) {
          const recallTool = await deps.recallTool(owner, data.sessionId, directory);
          if (recallTool)
            void deps.summaries.generate({
              recallTool,
              ...summary,
              sessionId: data.sessionId,
              owner,
              directory,
            });
        }
        deps.log.info({ ...data, ...ownerLog(owner), effective, overBudgetWarning, blocked }, 'context budget');
        return { blocked };
      });
    },
    { prefix: OPENCODE_CONTEXT_PATH },
  );
}
