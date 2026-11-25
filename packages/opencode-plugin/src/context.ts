import type { Hooks, PluginInput } from '@opencode-ai/plugin';

import { applySummary, freezePrefix, type Messages, projectHistory, type Summary } from './projection.ts';

const SUMMARY_BUDGET_RATIO = 0.75;
const BYTES_PER_TOKEN = 3;
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
// Provider 的视觉分词取决于分辨率和模型。每张图片预留估算额度，传输编码长度不参与视觉计费。
const IMAGE_TOKEN_ESTIMATE = 2048;
function fileBytes(file: Extract<Messages[number]['parts'][number], { type: 'file' }>): number {
  return file.mime.startsWith('image/')
    ? bytes({ ...file, url: '' }) + IMAGE_TOKEN_ESTIMATE * BYTES_PER_TOKEN
    : bytes(file);
}

export function historyBytes(messages: Messages): number {
  let size = 0;
  for (const { info, parts } of messages) {
    size += bytes(info.role);
    for (const p of parts) {
      // read.display 和 preview 只供界面显示，V1 不发给模型。
      if (p.type === 'tool' && p.state.status === 'completed') {
        size += bytes([p.tool, p.callID, p.state.input, p.state.output, p.metadata]);
        for (const file of p.state.attachments ?? []) size += fileBytes(file);
      } else {
        size += p.type === 'file' ? fileBytes(p) : bytes(p);
      }
    }
  }
  return size;
}

type RequestEstimate = {
  userId: string;
  agent: string;
  attemptId: string;
  before: number;
  after: number;
  system: number;
  toolBytes: number;
  externalTokens: number;
  knownTokens?: number;
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
    return (await res.json()) as { enabled: boolean; attemptId?: string | null; toolBytes?: number; summary?: Summary };
  }
  return {
    event: async ({ event }) => {
      if (event.type === 'session.idle') estimates.delete(event.properties.sessionID);
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
      if (!owner.attemptId || messages.some((m) => m.info.sessionID !== sessionId)) return;
      const folded = owner.enabled ? projectHistory(messages) : messages;
      const projected = applySummary(folded, owner.enabled ? owner.summary : undefined);
      const before = historyBytes(messages);
      const foldedBytes = folded === messages ? before : historyBytes(folded);
      const projectedBytes = projected === folded ? foldedBytes : historyBytes(projected);
      const candidate = projectedBytes < foldedBytes ? projected : folded;
      const after = Math.min(foldedBytes, projectedBytes);
      // V1 只公开原生/插件工具清单。额外 MCP 首轮按执行 MCP 的目录体积估算，
      // 同轮续跑可从 Provider 返回的实际输入中扣掉上一请求已计入的部分。
      const toolBytes = owner.toolBytes ?? 0;
      let externalTokens = Math.ceil((externalServers * toolBytes) / BYTES_PER_TOKEN);
      if (externalServers) {
        const previous = estimates.get(sessionId);
        const reply = messages.findLast(
          (m) => m.info.role === 'assistant' && m.info.time.completed !== undefined,
        )?.info;
        if (previous?.knownTokens !== undefined && reply?.role === 'assistant' && reply.parentID === previous.userId) {
          const used = reply.tokens.input + reply.tokens.cache.read + reply.tokens.cache.write;
          if (used > 0) externalTokens = Math.max(0, used - previous.knownTokens);
        }
      }
      estimates.set(sessionId, {
        attemptId: owner.attemptId,
        userId: user.id,
        agent: user.agent,
        before,
        after,
        system: 0,
        toolBytes,
        externalTokens,
        ...(owner.enabled && {
          freeze: () => freezePrefix(candidate, candidate === folded ? undefined : owner.summary?.uptoMessageId),
        }),
      });
      if (candidate !== messages && after < before) {
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
      estimate.knownTokens = Math.ceil((overhead + estimate.after) / BYTES_PER_TOKEN);
      const before = Math.ceil((overhead + estimate.before) / BYTES_PER_TOKEN) + estimate.externalTokens;
      const after = estimate.knownTokens + estimate.externalTokens;
      const prefix =
        limit !== null && after <= limit && after > limit * SUMMARY_BUDGET_RATIO ? estimate.freeze?.() : undefined;
      delete estimate.freeze;
      const res = await fetch(new URL('budget', api), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          directory: ctx.directory,
          sessionId: sessionID,
          attemptId: estimate.attemptId,
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
