import type { ProjectionReceipt } from '@aw/shared';
import {
  bytes,
  calibrate,
  DEFAULT_BYTES_PER_TOKEN,
  excessHistoryBytes,
  freezePrefix,
  historySize,
  modelInputBudget,
  projectWindow,
  requestRecallTool,
  type Sample,
  SOFT_BUDGET_RATIO,
  type Summary,
} from '@aw/shared/context';
import type { Hooks, PluginInput } from '@opencode-ai/plugin';

export { historyBytes } from '@aw/shared/context';

type Size = ReturnType<typeof historySize>;
type RequestEstimate = {
  receipt: ProjectionReceipt;
  userId: string;
  agent: string;
  ownerId: string;
  before: Size;
  after: Size;
  system: number;
  toolBytes: number;
  externalTokens: number;
  ratio: number;
  calibrated: boolean;
  model: string;
  lastReply?: string;
  sentBytes?: number;
  requestBudget?: { limit: number | null; overheadBytes: number };
  previousBill?: Sample;
  cacheRead: number;
  freeze?: () => ReturnType<typeof freezePrefix>;
};

export function contextHooks(ctx: PluginInput, api: string, token: string): Hooks {
  let managed = false;
  let externalServers = 0;
  const estimates = new Map<string, RequestEstimate>();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  async function scope(sessionId?: string) {
    const url = new URL('scope', api);
    url.searchParams.set('directory', ctx.directory);
    if (sessionId) url.searchParams.set('sessionId', sessionId);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`AW context scope unavailable: ${res.status}`);
    return (await res.json()) as {
      enabled: boolean;
      kind?: 'attempt' | 'assistant';
      ownerId?: string | null;
      toolBytes?: number;
      recallTool?: string;
      summary?: Summary;
    };
  }
  return {
    event: async ({ event }) => {
      if (event.type === 'session.compacted') estimates.delete(event.properties.sessionID);
      if (event.type === 'session.deleted') estimates.delete(event.properties.info.id);
    },
    config: async (cfg) => {
      managed = (await scope()).enabled;
      if (!managed) return;
      externalServers = Object.entries(cfg.mcp ?? {}).filter(
        ([name, server]) => !['agent-workflow', 'agent-workflow-app'].includes(name) && server.enabled !== false,
      ).length;
      Object.assign(cfg, {
        compaction: {
          ...('compaction' in cfg && typeof cfg.compaction === 'object' ? cfg.compaction : {}),
          auto: false,
          prune: false,
        },
      });
    },
    'experimental.chat.messages.transform': async (_, { messages }) => {
      if (!managed) return;
      const user = messages.findLast((m) => m.info.role === 'user')?.info;
      if (user?.role !== 'user') return;
      const sessionId = user.sessionID;
      const owner = await scope(sessionId);
      if (
        !owner.ownerId ||
        (!owner.enabled && owner.kind === 'assistant') ||
        messages.some((m) => m.info.sessionID !== sessionId)
      ) {
        estimates.delete(sessionId);
        return;
      }
      const before = historySize(messages);
      const toolBytes = owner.toolBytes ?? 0;
      const model = `${user.model.providerID}/${user.model.modelID}`;
      const prior = estimates.get(sessionId);
      const previous = prior?.model === model ? prior : undefined;
      let ratio = previous?.ratio ?? DEFAULT_BYTES_PER_TOKEN;
      let calibrated = previous?.calibrated ?? false;
      let externalTokens =
        previous?.externalTokens ?? Math.ceil((externalServers * toolBytes) / DEFAULT_BYTES_PER_TOKEN);
      let previousBill = previous?.previousBill;
      let lastReply = previous?.lastReply;
      let cacheRead = previous?.cacheRead ?? 0;
      const reply = messages.findLast((m) => m.info.role === 'assistant' && m.info.time.completed !== undefined)?.info;
      if (
        previous?.sentBytes !== undefined &&
        reply?.role === 'assistant' &&
        !reply.error &&
        !reply.summary &&
        reply.parentID === previous.userId &&
        reply.id !== lastReply &&
        model === `${reply.providerID}/${reply.modelID}`
      ) {
        const used = reply.tokens.input + reply.tokens.cache.read + reply.tokens.cache.write;
        if (used > 0) {
          const sample = { bytes: previous.sentBytes, tokens: used - previous.after.media };
          const next = calibrate(sample, previousBill, externalServers > 0);
          if (next !== undefined) {
            ratio = next;
            calibrated = true;
          }
          if (externalServers && (!previousBill || next !== undefined))
            externalTokens = Math.max(0, Math.round(sample.tokens - sample.bytes / ratio));
          previousBill = sample;
          cacheRead = reply.tokens.cache.read;
          lastReply = reply.id;
        }
      }
      const formatBytes = 'format' in user && user.format ? bytes(user.format) : 0;
      // V1 的 messages.transform 先于 system.transform / chat.params。连续步骤使用同一模型实测的
      // 系统提示、工具与输入额度；恢复旧历史或切换模型时，从该目录的模型目录重新取上限。
      const recallTool = owner.enabled ? requestRecallTool(owner.recallTool, user.tools) : undefined;
      let requestBudget =
        previous?.userId === user.id && previous.agent === user.agent ? previous.requestBudget : undefined;
      if (!requestBudget && recallTool && (before.toolOutput > 0 || owner.summary)) {
        const query = { directory: ctx.directory };
        const [catalog, tools] = await Promise.all([
          ctx.client.config.providers({ query, throwOnError: true }),
          ctx.client.tool.list({
            query: { ...query, provider: user.model.providerID, model: user.model.modelID },
            throwOnError: true,
          }),
        ]);
        const spec = catalog.data.providers.find((provider) => provider.id === user.model.providerID)?.models[
          user.model.modelID
        ];
        if (spec)
          requestBudget = {
            limit: modelInputBudget(spec.limit),
            overheadBytes: bytes(user.system ?? '') + bytes(tools.data),
          };
      }
      const excess = requestBudget
        ? excessHistoryBytes(
            before,
            requestBudget.limit,
            requestBudget.overheadBytes + toolBytes + formatBytes,
            externalTokens,
            ratio,
          )
        : 0;
      const {
        projected: candidate,
        receipt,
        summarySource,
      } = projectWindow(messages, excess, recallTool, owner.summary);
      // 下一钩子才决定是否启动无工具的摘要 Worker；即使主请求原地折叠，Worker 仍读原文。
      const source = summarySource === messages && candidate !== messages ? messages.slice() : summarySource;
      const after = candidate === messages ? before : historySize(candidate);
      estimates.set(sessionId, {
        receipt,
        ownerId: owner.ownerId,
        userId: user.id,
        agent: user.agent,
        before,
        after,
        system: 0,
        toolBytes,
        externalTokens,
        ratio,
        calibrated,
        model,
        cacheRead,
        ...(lastReply && { lastReply }),
        ...(previousBill && { previousBill }),
        ...(recallTool && {
          freeze: () => freezePrefix(source, receipt.anchor ?? undefined),
        }),
      });
      if (candidate !== messages && after.text < before.text) {
        // V1 持有原数组的引用。此处没有 await，下一步转换只能看到完整投影。
        Object.assign(messages, candidate);
        messages.length = candidate.length;
      }
    },
    'experimental.chat.system.transform': async ({ sessionID }, { system }) => {
      const estimate = sessionID && estimates.get(sessionID);
      if (estimate) estimate.system = bytes(system);
    },
    'chat.params': async ({ sessionID, model, message, agent }, params) => {
      const estimate = estimates.get(sessionID);
      if (!estimate || estimate.userId !== message.id || estimate.agent !== agent) return;
      // V1 在传输错误后可重新进入 chat.params，同一轮重试仍需刹车。
      const tools = await ctx.client.tool.list({
        query: { directory: ctx.directory, provider: model.providerID, model: model.id },
        throwOnError: true,
      });
      const formatBytes = 'format' in message && message.format ? bytes(message.format) : 0;
      const nativeBytes = bytes(tools.data);
      const overhead = estimate.system + estimate.toolBytes + nativeBytes + formatBytes;
      // UTF-8 字节近似，输入上限与上下文减去本次输出预留二者取小。
      const outputReserve = params.maxOutputTokens ?? model.limit.output;
      const limit = modelInputBudget(model.limit, outputReserve);
      estimate.requestBudget = { limit, overheadBytes: estimate.system + nativeBytes };
      const ratio = estimate.ratio;
      const tokens = (value: number) => Math.ceil(value / ratio);
      const systemTokens = tokens(estimate.system + formatBytes);
      const toolTokens = tokens(estimate.toolBytes + nativeBytes);
      const total = (size: Size) =>
        systemTokens +
        toolTokens +
        tokens(size.dialogue) +
        tokens(size.toolOutput) +
        tokens(size.summary) +
        size.media +
        estimate.externalTokens;
      estimate.sentBytes = overhead + estimate.after.text;
      const before = total(estimate.before),
        after = total(estimate.after);
      const breakdown = {
        systemTokens,
        toolTokens,
        dialogueTokens: tokens(estimate.after.dialogue),
        toolOutputTokens: tokens(estimate.after.toolOutput),
        summaryTokens: tokens(estimate.after.summary),
        mediaTokens: estimate.after.media,
        externalTokens: estimate.externalTokens,
        outputReserve,
        bytesPerToken: ratio,
        calibrated: estimate.calibrated,
        cacheRead: estimate.cacheRead,
        overBudgetWarning: limit !== null && after > limit,
      };
      const prefix = limit !== null && after > limit * SOFT_BUDGET_RATIO ? estimate.freeze?.() : undefined;
      delete estimate.freeze;
      const res = await fetch(new URL('budget', api), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          directory: ctx.directory,
          sessionId: sessionID,
          ownerId: estimate.ownerId,
          ...breakdown,
          model: `${model.providerID}/${model.id}`,
          receipt: estimate.receipt,
          before,
          after,
          limit,
          ...(prefix && { summary: { ...prefix, model: `${model.providerID}/${model.id}` } }),
        }),
      });
      if (!res.ok) throw new Error(`AW context budget unavailable: ${res.status}`);
      const result = (await res.json()) as { blocked: boolean };
      if (result.blocked) throw new Error('AW context budget exceeded');
    },
  };
}
