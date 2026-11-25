import type { ContextDetailDTO } from '@aw/shared';
import {
  activeWindow,
  DEFAULT_BYTES_PER_TOKEN,
  eligible,
  hasModelContent,
  historySize,
  type Messages,
  projectionReceipt,
  projectWindow,
  referenceText,
  SUMMARY_LABEL,
} from '@aw/shared/context';
import type { OpencodeClient } from './opencode.client.ts';
import type { createBudgetSnapshots } from './opencode.context.ts';
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
  canProject: (directory: string, taskId: string) => boolean,
) {
  return async function inspect({
    sessionId,
    directory,
    stopped = false,
    model: configured = null,
    attemptId,
    taskId,
  }: {
    sessionId: string | null;
    directory: string;
    stopped?: boolean;
    model?: string | null;
    attemptId?: string;
    taskId?: string | null;
  }): Promise<ContextDetailDTO> {
    const cached = sessionId && attemptId ? snapshots.get(sessionId) : undefined;
    const snapshot = cached?.attemptId === attemptId ? cached : undefined;
    const budget = snapshot ?? null;
    const history = sessionId ? await opencode.sessionMessages({ sessionId, directory }) : [];
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
    const lastRequest = active.findLastIndex((m) => m.info === reply);
    const nativeSent = new Set(
      active
        .slice(0, Math.max(0, lastRequest))
        .filter(hasModelContent)
        .map((m) => m.info.id),
    );
    const billed = reply?.role === 'assistant' ? reply.tokens : null;
    const user = active.findLast((m) => m.info.role === 'user')?.info;
    const requested =
      user?.role === 'user' && user.model ? `${user.model.providerID}/${user.model.modelID}` : configured;
    const model = budget?.model ?? (reply?.role === 'assistant' ? `${reply.providerID}/${reply.modelID}` : requested);
    const catalog = sessionId && budget === null ? await opencode.listModels(directory) : null;
    const limit = budget
      ? budget.limit
      : (catalog?.available.find((m) => `${m.providerId}/${m.modelId}` === (model ?? catalog.defaultModel))
          ?.contextLimit ?? null);
    const rate = budget?.bytesPerToken ?? DEFAULT_BYTES_PER_TOKEN;
    const summary = sessionId && attemptId ? (summaries.get(sessionId) ?? null) : null;
    // 进程重启或快照淘汰后只能按当前规则重建，不能把后来发布的摘要冒充历史发送记录。
    let receipt = snapshot?.receipt;
    const reconstructed = !receipt && !!sessionId && !!taskId && canProject(directory, taskId);
    if (reconstructed) {
      const { folded, projected } = projectWindow(active, summary ?? undefined);
      receipt = projectionReceipt(active, folded, projected, summary ?? undefined);
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
        const reference = referenceText(p, id);
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
    const raw = historySize(active);
    const historyParts = {
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
      model: model ?? catalog?.defaultModel ?? null,
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
