import type { Hooks, PluginInput } from '@opencode-ai/plugin';

type Messages = Parameters<NonNullable<Hooks['experimental.chat.messages.transform']>>[1]['messages'];
type Part = Messages[number]['parts'][number];

function reference(part: Part, messageId: string): Part {
  if (
    part.type !== 'tool' ||
    part.tool !== 'read' ||
    part.messageID !== messageId ||
    !part.callID ||
    !part.id ||
    part.state.status !== 'completed' ||
    Object.keys(part.metadata ?? {}).length
  )
    return part;
  const { state } = part;
  const { loaded, display } = state.metadata;
  if (Object.keys(state.metadata).some((key) => !['loaded', 'display', 'preview', 'truncated'].includes(key)))
    return part;
  if (
    !Array.isArray(loaded) ||
    loaded.length ||
    typeof display !== 'object' ||
    display === null ||
    !('type' in display) ||
    display.type !== 'file' ||
    !('path' in display) ||
    typeof display.path !== 'string' ||
    typeof state.output !== 'string' ||
    state.attachments?.length ||
    state.time.compacted !== undefined ||
    state.output.includes('<system-reminder>') ||
    /(?:^|[/\\])(?:agents\.md|claude\.md|context\.md|copilot-instructions\.md)$/i.test(display.path)
  )
    return part;
  const output = `[AW read messageId=${messageId} partId=${part.id} path=${display.path}]`;
  return output.length < state.output.length ? { ...part, state: { ...state, output } } : part;
}

/** 只替换结果正文，保留原消息顺序、调用参数与 callID。最新工具批次包括同消息的所有兄弟调用。 */
export function projectHistory(messages: Messages): Messages {
  const latest = messages.findLastIndex((m) => m.parts.some((p) => p.type === 'tool'));
  return messages.map((m, i) => {
    if (
      i >= latest ||
      m.info.role !== 'assistant' ||
      m.info.error ||
      m.info.time.completed === undefined ||
      m.parts.some(
        (p) =>
          p.messageID !== m.info.id ||
          p.sessionID !== m.info.sessionID ||
          (p.type === 'reasoning' && Object.keys(p.metadata ?? {}).length > 0) ||
          (p.type === 'tool' && p.state.status !== 'completed'),
      )
    )
      return m;
    return { ...m, parts: m.parts.map((p) => reference(p, m.info.id)) };
  });
}

const BYTES_PER_TOKEN = 3;
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
function historyBytes(messages: Messages): number {
  let size = 0;
  for (const { info, parts } of messages) {
    size += bytes(info.role);
    for (const p of parts) {
      // read.display 和 preview 只供界面显示，V1 不发给模型。
      size +=
        p.type === 'tool' && p.state.status === 'completed'
          ? bytes([p.tool, p.callID, p.state.input, p.state.output, p.state.attachments, p.metadata])
          : bytes(p);
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
    return (await res.json()) as { enabled: boolean; attemptId?: string | null; toolBytes?: number };
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
      const candidate = owner.enabled ? projectHistory(messages) : messages;
      const before = historyBytes(messages);
      const after = candidate === messages ? before : historyBytes(candidate);
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
      });
      if (candidate !== messages && after < before) {
        // V1 持有原数组的引用。此处没有 await，下一步转换只能看到完整投影。
        Object.assign(messages, candidate);
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
      const input =
        'input' in model.limit && typeof model.limit.input === 'number' ? model.limit.input : model.limit.context;
      const limit = Math.max(0, Math.min(input, model.limit.context - (params.maxOutputTokens ?? model.limit.output)));
      estimate.knownTokens = Math.ceil((overhead + estimate.after) / BYTES_PER_TOKEN);
      const before = Math.ceil((overhead + estimate.before) / BYTES_PER_TOKEN) + estimate.externalTokens;
      const after = estimate.knownTokens + estimate.externalTokens;
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
        }),
      });
      if (!res.ok) throw new Error(`AW context budget unavailable: ${res.status}`);
      const result = (await res.json()) as { blocked: boolean };
      if (result.blocked) throw new Error('AW context budget exceeded');
    },
  };
}
