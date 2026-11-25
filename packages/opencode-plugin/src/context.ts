import type { ProjectionReceipt } from '@aw/shared';
import {
  bytes,
  calibrate,
  DEFAULT_BYTES_PER_TOKEN,
  freezePrefix,
  historySize,
  projectionReceipt,
  projectWindow,
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
      const { folded, projected: candidate } = owner.enabled
        ? projectWindow(messages, owner.summary, owner.recallTool)
        : { folded: messages, projected: messages };
      const before = historySize(messages);
      const after = historySize(candidate);
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
      const receipt = projectionReceipt(messages, folded, candidate, owner.summary);
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
        ...(owner.enabled && {
          freeze: () => freezePrefix(candidate, candidate === folded ? undefined : owner.summary?.uptoMessageId),
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
      const overhead = estimate.system + estimate.toolBytes + bytes(tools.data) + formatBytes;
      // UTF-8 字节近似，输入上限与上下文减去本次输出预留二者取小。
      const { context, output } = model.limit;
      const input =
        'input' in model.limit && typeof model.limit.input === 'number' && model.limit.input > 0
          ? model.limit.input
          : context;
      const limit = context > 0 ? Math.max(0, Math.min(input, context - (params.maxOutputTokens ?? output))) : null;
      const ratio = estimate.ratio;
      const tokens = (value: number) => Math.ceil(value / ratio);
      const systemTokens = tokens(estimate.system + formatBytes);
      const toolTokens = tokens(estimate.toolBytes + bytes(tools.data));
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
        outputReserve: params.maxOutputTokens ?? output,
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
