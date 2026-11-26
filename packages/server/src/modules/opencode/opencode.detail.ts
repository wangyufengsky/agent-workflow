import type { Prompts } from '@aw/builtin';
import type { ContextDetailDTO } from '@aw/shared';
import {
  activeWindow,
  DEFAULT_BYTES_PER_TOKEN,
  eligible,
  excessHistoryBytes,
  hasModelContent,
  historySize,
  type Messages,
  projectWindow,
  referenceText,
  requestRecallTool,
  SUMMARY_LABEL,
} from '@aw/shared/context';
import { type OpencodeClient, parseModelRef } from './opencode.client.ts';
import { contextBasePrompt } from './opencode.config.ts';
import type { createBudgetSnapshots } from './opencode.context.ts';
import { type ContextOwner, recallToolName } from './opencode.context-owner.ts';
import type { createContextSummaries } from './opencode.summaries.ts';

const PREVIEW_CHARS = 8192;
function preview(text: string) {
  return { preview: text.slice(0, PREVIEW_CHARS), length: text.length, truncated: text.length > PREVIEW_CHARS };
}
function body(m: Messages[number]) {
  return m.parts
    .flatMap((p) => {
      if (p.type === 'text' || p.type === 'reasoning') return [p.text];
      if (p.type === 'tool')
        return [
          `${p.tool} ${JSON.stringify(p.state.input)}`,
          p.state.status === 'completed' ? p.state.output : p.state.status === 'error' ? p.state.error : p.state.status,
        ];
      if (p.type === 'file') return [p.filename ?? p.mime];
      if (p.type === 'compaction') return ['compaction'];
      return [];
    })
    .join('\n');
}
export function createContextInspector(
  opencode: OpencodeClient,
  snapshots: ReturnType<typeof createBudgetSnapshots>,
  summaries: ReturnType<typeof createContextSummaries>,
  prompts: Prompts,
  mcpToolBytes: (execution: boolean) => number,
  canProject: (directory: string) => boolean,
  recallTool: (
    owner: ContextOwner,
    sessionId: string,
    directory: string,
    agent?: string,
  ) => Promise<string | undefined>,
) {
  const nativeSizes = new Map<string, Promise<number>>();
  function nativeBytes(directory: string, model: string) {
    const key = JSON.stringify([directory, model]);
    const known = nativeSizes.get(key);
    if (known) return known;
    const size = opencode.nativeToolBytes(directory, parseModelRef(model)).catch(() => {
      if (nativeSizes.get(key) === size) nativeSizes.delete(key);
      return 0; // 原生定义暂不可用，仍计入 AW MCP，刷新可重新读取。
    });
    nativeSizes.set(key, size);
    const oldest = nativeSizes.keys().next().value;
    if (nativeSizes.size > 64 && oldest !== undefined) nativeSizes.delete(oldest);
    return size;
  }
  return async function inspect({
    sessionId,
    directory,
    stopped = false,
    model: configured = null,
    owner,
  }: {
    sessionId: string | null;
    directory: string;
    stopped?: boolean;
    model?: string | null;
    owner: ContextOwner;
  }): Promise<ContextDetailDTO> {
    const cached = sessionId ? snapshots.get(sessionId) : undefined;
    const snapshot = cached?.ownerId === owner.id ? cached : undefined;
    const budget = snapshot ?? null;
    const connected = sessionId && opencode.isConnected();
    const fallback = connected && !budget;
    const historyRequest = connected ? opencode.sessionMessages({ sessionId, directory }) : Promise.resolve([]);
    const windowRequest = historyRequest.then((history) => {
      const active = activeWindow(history);
      const live = new Set(active.map((m) => m.info.id));
      const compacted = history.findLastIndex(
        (m) => m.info.role === 'assistant' && m.info.summary && m.info.finish && !m.info.error,
      );
      const reply = history
        .slice(compacted + 1)
        .findLast(
          (m) =>
            live.has(m.info.id) && m.info.role === 'assistant' && !m.info.error && m.info.time.completed !== undefined,
        )?.info;
      const lastUser = active.findLast((m) => m.info.role === 'user')?.info;
      const user = lastUser?.role === 'user' ? lastUser : undefined;
      const model =
        reply?.role === 'assistant' && reply.providerID && reply.modelID
          ? `${reply.providerID}/${reply.modelID}`
          : user?.model
            ? `${user.model.providerID}/${user.model.modelID}`
            : configured;
      return { history, active, live, reply, user, model };
    });
    const catalogRequest = fallback ? opencode.listModels(directory) : Promise.resolve(null);
    const lookup = (model: string | null | undefined) => (model ? nativeBytes(directory, model) : 0);
    const toolRequest = !fallback
      ? 0
      : configured
        ? lookup(configured)
        : windowRequest.then(async (w) => lookup(w.model ?? (await catalogRequest)?.defaultModel));
    const [window, catalog, initialBytes] = await Promise.all([windowRequest, catalogRequest, toolRequest]);
    const { history, active, live, reply, user } = window;
    const model = budget?.model ?? window.model ?? catalog?.defaultModel ?? null;
    const lastRequest = active.findLastIndex((m) => m.info === reply);
    const nativeSent = new Set(
      active
        .slice(0, Math.max(0, lastRequest))
        .filter(hasModelContent)
        .map((m) => m.info.id),
    );
    const billed = reply?.role === 'assistant' ? reply.tokens : null;
    const limit = budget
      ? budget.limit
      : (catalog?.available.find((m) => `${m.providerId}/${m.modelId}` === model)?.inputBudget ?? null);
    const rate = budget?.bytesPerToken ?? DEFAULT_BYTES_PER_TOKEN;
    const native = fallback && configured && model !== configured ? await lookup(model) : initialBytes;
    const systemBytes = budget
      ? 0
      : Buffer.byteLength(contextBasePrompt(prompts, user?.agent, owner.kind === 'attempt')) +
        Buffer.byteLength(user?.system ?? '');
    const toolsBytes = budget ? 0 : mcpToolBytes(owner.kind === 'attempt') + native;
    // 有回执时展示当时实际发送的引用；重建才读取此物理会话当前的权限。
    const recall = snapshot
      ? recallToolName(owner.kind)
      : connected
        ? await recallTool(owner, sessionId, directory, user?.agent)
        : undefined;
    const summary = sessionId ? (summaries.get(sessionId, owner) ?? null) : null;
    // 进程重启或快照淘汰后只能按当前规则重建，不能把后来发布的摘要冒充历史发送记录。
    let receipt = snapshot?.receipt;
    let countedWindow = active;
    const reconstructed = !receipt && !!sessionId && (!!summary || canProject(directory));
    if (reconstructed) {
      const excess = excessHistoryBytes(historySize(active), limit, systemBytes + toolsBytes, 0, rate);
      const window = projectWindow(active, excess, requestRecallTool(recall, user?.tools), summary ?? undefined);
      countedWindow = window.projected;
      receipt = window.receipt;
    }
    const sent = new Set(receipt?.sent);
    const removed = new Set(receipt?.summarized);
    const protectedIds = new Set(receipt?.protected);
    const foldedIds = new Set(receipt?.folded);
    const folded: ContextDetailDTO['folded'] = [];
    const counted = (m: Messages[number]) => {
      const n = historySize([m]);
      return Math.ceil(n.text / rate) + n.media;
    };
    const messages = history.map((m) => {
      const id = m.info.id;
      const archived = !live.has(id);
      const hasSummary = !archived && (removed.has(id) || id === receipt?.anchor);
      const parts = m.parts.map((p) => {
        if (archived || hasSummary || !foldedIds.has(p.id) || p.type !== 'tool' || p.state.status !== 'completed')
          return p;
        const reference = referenceText(p, id, recall);
        if (!reference) return p;
        folded.push({
          messageId: id,
          partId: p.id,
          path: String(p.state.input.filePath ?? p.state.title),
          ...preview(p.state.output),
          referenceLength: reference.length,
        });
        return { ...p, state: { ...p.state, output: reference } };
      });
      const status = archived
        ? 'archived'
        : hasSummary
          ? 'summarized'
          : parts.some((p, i) => p !== m.parts[i])
            ? 'folded'
            : protectedIds.has(id) || !eligible(m) || m.info.role === 'user'
              ? 'protected'
              : 'kept';
      const tokens = counted(m);
      const projectedTokens =
        archived || removed.has(id)
          ? 0
          : id === receipt?.anchor
            ? Math.ceil(Buffer.byteLength(SUMMARY_LABEL + receipt.summaryText) / rate)
            : counted({ ...m, parts });
      const title =
        m.parts.find((p) => p.type === 'tool')?.tool ??
        m.parts.find((p) => p.type === 'text')?.text.slice(0, 72) ??
        m.parts[0]?.type ??
        m.info.role;
      const actual =
        receipt?.anchor === id
          ? SUMMARY_LABEL + (receipt.summaryText ?? '')
          : status === 'folded'
            ? body({ ...m, parts })
            : undefined;
      return {
        ...(actual !== undefined && { projectedPreview: preview(actual).preview }),
        id,
        role: m.info.role,
        status,
        tokens,
        projectedTokens,
        title,
        ...preview(body(m)),
        sent: !budget?.blocked && !archived && (receipt ? sent.has(id) : nativeSent.has(id)),
      } satisfies ContextDetailDTO['messages'][number];
    });
    const raw = historySize(countedWindow);
    const historyParts = {
      system: budget?.systemTokens ?? Math.ceil(systemBytes / rate),
      tools: budget ? budget.toolTokens + budget.externalTokens : Math.ceil(toolsBytes / rate),
      dialogue: Math.ceil(raw.dialogue / rate),
      toolOutput: Math.ceil(raw.toolOutput / rate),
      summary: Math.ceil(raw.summary / rate),
      media: raw.media,
    };
    return {
      reconstructed,
      budget,
      historyEstimate: Object.values(historyParts).reduce((a, b) => a + b, 0),
      historyParts,
      model,
      limit,
      cacheRead: billed?.cache.read ?? null,
      measuredInput: billed ? billed.input + billed.cache.read + billed.cache.write : null,
      managed: !!snapshot || reconstructed || !!summary,
      stopped,
      compactionRequests: history.filter((m) => m.info.role === 'user' && m.parts.some((p) => p.type === 'compaction'))
        .length,
      compactions: history.filter(
        (m) => m.info.role === 'assistant' && m.info.summary && m.info.finish && !m.info.error,
      ).length,
      summary,
      folded,
      messages,
    };
  };
}
