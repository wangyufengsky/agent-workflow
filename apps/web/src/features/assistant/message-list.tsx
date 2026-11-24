import {
  type AssistantConfirmationDTO,
  type AssistantConversationDTO,
  AssistantToolName,
  MCP_ASSISTANT_TOOL_PREFIX,
  needsConfirmationOutputSchema,
  PermissionDecision,
  type TranscriptEntry,
  TranscriptEntryKind,
  UiMode,
} from '@aw/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CatchBoundary, type ErrorComponentProps } from '@tanstack/react-router';
import { memo, type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ASSISTANT_CONTINUATION_COPY } from '../../copy/assistant-continuation.ts';
import { ATTEMPT_COPY, STREAM_COPY, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { Character } from '../companion/character.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { UsedSkills } from '../skills/used-skills.tsx';
import { LatestButton } from '../stream/latest-button.tsx';
import { thinkingSeconds } from '../stream/stream-items.ts';
import { ThinkingBlock } from '../stream/thinking-block.tsx';
import { useStickToBottom } from '../stream/use-stick-to-bottom.ts';
import styles from './assistant.module.css';
import {
  confirmationsQuery,
  conversationTranscript,
  useAssistantHistory,
  useReplyAssistantPermission,
} from './assistant.queries.ts';
import { AssistantWelcome } from './assistant-welcome.tsx';
import cards from './cards.module.css';
import { ChartCard } from './chart-card.tsx';
import { ConfirmationCard } from './confirmation-card.tsx';
import { ContinuationSource } from './continuation-source.tsx';
import { useContinueConversation } from './conversation-continuation.tsx';
import { EntityCard } from './entity-card.tsx';
import { FileCard } from './file-card.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';
import { type ToolResult, ToolRow } from './tool-row.tsx';

/** A call that waits for the user shows as its confirmation card, not as a row of its own (15 §4). */
function waitsForConfirmation(tool: string, result: ToolResult | undefined): boolean {
  if (!tool.startsWith(MCP_ASSISTANT_TOOL_PREFIX)) return false;
  if (result?.data.status !== 'completed' || result.data.output === undefined) return false;
  let output: unknown;
  try {
    output = JSON.parse(result.data.output);
  } catch (error) {
    // opencode 可截断工具输出。此时保留普通操作行，用户仍可查看原文。
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  return needsConfirmationOutputSchema.safeParse(output).success;
}

const CHART_TOOLS: ReadonlySet<string> = new Set(
  [AssistantToolName.ShowChart, AssistantToolName.ShowFlowchart].map((name) => `${MCP_ASSISTANT_TOOL_PREFIX}${name}`),
);

/** In simple mode a chart stands for the call that drew it; a failed call still shows (35 §5.4). */
function drewChart(tool: string, result: ToolResult | undefined): boolean {
  return CHART_TOOLS.has(tool) && result?.data.status === 'completed';
}

function PermissionCard({
  conversation,
  permissionId,
  text,
}: {
  conversation: AssistantConversationDTO;
  permissionId: string;
  text: string;
}) {
  const reply = useReplyAssistantPermission();
  const open = conversation.pendingPermissions.find((p) => p.permissionId === permissionId);
  if (!open) return <p className={styles.system}>{text}</p>;
  const answer = (decision: PermissionDecision) => reply.mutate({ id: conversation.id, permissionId, reply: decision });
  return (
    <section className={cards.card} data-tone="wait" aria-label={C.permissionTitle}>
      <header className={cards.cardHead}>
        <span className={cards.tile} data-tone="accent" aria-hidden="true">
          <Icon name="lock" size="sm" />
        </span>
        <span className={cards.cardHeading}>
          <span className={cards.cardTitle}>{C.permissionTitle}</span>
        </span>
      </header>
      {open.reason && <p>{open.reason}</p>}
      <pre className={cards.json}>{open.bashGrant?.command ?? text}</pre>
      {open.bashGrant && <p className="hint">{open.bashGrant.directory}</p>}
      <div className={cards.actions}>
        <Button size="sm" variant="primary" disabled={reply.isPending} onClick={() => answer(PermissionDecision.Once)}>
          {C.permissionAllowOnce}
        </Button>
        {open.bashGrant !== null && (
          <Button size="sm" disabled={reply.isPending} onClick={() => answer(PermissionDecision.Always)}>
            {open.bashGrant ? C.permissionConversation : C.permissionAlways}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={reply.isPending} onClick={() => answer(PermissionDecision.Reject)}>
          {C.permissionReject}
        </Button>
      </div>
      {reply.isError && <ErrorState error={reply.error} />}
    </section>
  );
}

type Rendered = {
  conversation: AssistantConversationDTO;
  confirmations: ReadonlyMap<string, AssistantConfirmationDTO>;
  results: ReadonlyMap<string, ToolResult>;
  pro: boolean;
  onContinue: (() => void) | null;
  /** Where the latest turn starts: the last user message's `seq`. */
  turnStart: number;
  /** The text or thinking the assistant is writing right now (a typing caret, the thinking's last lines). */
  writingKey: string | number | undefined;
  /** How long each thinking part took, by `partId`. */
  seconds: ReadonlyMap<string, number>;
};

const keyOf = (entry: TranscriptEntry) => ('partId' in entry ? entry.partId : entry.seq);

function Body({ entry, ctx, fresh }: { entry: TranscriptEntry; ctx: Rendered; fresh: boolean }): ReactNode {
  switch (entry.kind) {
    case TranscriptEntryKind.UserMessage:
      return (
        <div className={styles.userTurn}>
          <div className={styles.user} data-testid="assistant-user-message">
            {entry.data.text}
          </div>
          {entry.data.attachments !== undefined && <SentAttachments attachments={entry.data.attachments} />}
          {entry.data.skills !== undefined && <UsedSkills skills={entry.data.skills} />}
        </div>
      );
    case TranscriptEntryKind.Text:
      return (
        <div className={ctx.writingKey === keyOf(entry) ? `${styles.reply} ${styles.streaming}` : styles.reply}>
          <ReplyMarkdown source={entry.data.text} />
        </div>
      );
    case TranscriptEntryKind.Reasoning:
      return (
        <ThinkingBlock
          text={entry.data.text}
          seconds={ctx.seconds.get(entry.partId)}
          writing={ctx.writingKey === entry.partId}
        />
      );
    case TranscriptEntryKind.ToolCall: {
      const result = ctx.results.get(entry.data.callId);
      if (waitsForConfirmation(entry.data.tool, result)) return null;
      if (!ctx.pro && drewChart(entry.data.tool, result)) return null;
      // Only a call of the turn in progress can still run; one left without a result earlier was stopped.
      const running = ctx.conversation.busy && entry.seq > ctx.turnStart;
      return <ToolRow call={entry} conversationId={ctx.conversation.id} result={result} busy={running} pro={ctx.pro} />;
    }
    case TranscriptEntryKind.ToolResult:
      // Shown with its call.
      return null;
    case TranscriptEntryKind.Permission:
      return (
        <PermissionCard
          conversation={ctx.conversation}
          permissionId={entry.data.permissionId}
          text={ATTEMPT_COPY.permission(entry.data.permission, entry.data.patterns.join(' '))}
        />
      );
    case TranscriptEntryKind.Confirmation: {
      const confirmation = ctx.confirmations.get(entry.data.confirmationId);
      return confirmation === undefined ? null : <ConfirmationCard confirmation={confirmation} />;
    }
    case TranscriptEntryKind.Attachment:
      return <FileCard conversationId={ctx.conversation.id} path={entry.data.path} lost={entry.data.lost ?? []} />;
    case TranscriptEntryKind.EntityRef:
      return <EntityCard entity={entry.data} />;
    case TranscriptEntryKind.Chart:
      return <ChartCard chart={entry.data.chart} fresh={fresh} />;
    case TranscriptEntryKind.System: {
      // Same notice as a task step's stream, e.g. why opencode is retrying the model request (D163).
      const label = TRANSCRIPT_SYSTEM_LABEL[entry.data.event];
      const { detail } = entry.data;
      return <p className={styles.system}>{detail === undefined ? label : STREAM_COPY.noticeDetail(label, detail)}</p>;
    }
    case TranscriptEntryKind.Error: {
      // The provider's own words, when it sent some (opencode's error data).
      const said = entry.data.details?.message;
      const overflow = entry.data.details?.opencodeErrorName === 'ContextOverflowError';
      return (
        <div className={styles.error} role="status">
          <Icon name="alert" size="sm" />
          <span className="grow">
            <span className={styles.errorTitle}>
              {overflow ? ASSISTANT_CONTINUATION_COPY.overflow : ERROR_COPY[entry.data.code]}
            </span>
            {typeof said === 'string' && <span className={styles.errorMessage}>{said}</span>}
            {ctx.pro && (
              <span className={`${styles.errorMessage} mono`}>
                {entry.data.code} · {entry.data.message}
              </span>
            )}
          </span>
          {overflow && entry.seq > ctx.turnStart && ctx.onContinue !== null && (
            <Button size="sm" variant="ghost" onClick={ctx.onContinue}>
              {ASSISTANT_CONTINUATION_COPY.action}
            </Button>
          )}
        </div>
      );
    }
  }
}

/** 单条历史记录可能来自旧版。重试只重读记录和确认卡片，不重新执行工具。 */
function useHistoryError(conversationId: string, message: string) {
  const client = useQueryClient();
  return useCallback(
    ({ error, reset }: ErrorComponentProps) => {
      const retry = async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: conversationTranscript(conversationId).key, exact: true }),
          client.invalidateQueries({ queryKey: confirmationsQuery(conversationId).queryKey, exact: true }),
        ]);
        reset();
      };
      return <ErrorState error={error} message={message} onRetry={() => void retry()} />;
    },
    [client, conversationId, message],
  );
}

const Message = memo(function Message({
  entry,
  ctx,
  fresh,
}: {
  entry: TranscriptEntry;
  ctx: Rendered;
  /** Arrived after the conversation opened: a chart grows in (35 §5.4). */
  fresh: boolean;
}) {
  const body = Body({ entry, ctx, fresh });
  if (body === null) return null;
  return (
    <div className={styles.message} data-kind={entry.kind} data-fresh={fresh || undefined}>
      {body}
    </div>
  );
});

/** The working indicator (15 §6): the assistant's mark turning and a line of light passing over the words. */
function Thinking({ queuePosition }: { queuePosition: number | null }) {
  return (
    <div className={`${styles.message} ${styles.thinking}`} role="status" data-testid="assistant-thinking">
      <Character mood="thinking" />
      <span className="shimmer">{queuePosition === null ? C.thinking : ATTEMPT_COPY.queued(queuePosition)}</span>
    </div>
  );
}

function Stream({
  conversation,
  entries,
  pages,
}: {
  conversation: AssistantConversationDTO;
  entries: readonly TranscriptEntry[];
  pages: ReturnType<typeof useAssistantHistory>['pages'];
}) {
  const messageError = useHistoryError(conversation.id, C.messageUnavailable);
  const confirmations = useQuery(confirmationsQuery(conversation.id)).data;
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const onContinue = useContinueConversation()?.start ?? null;
  const [openedThrough] = useState(() => Math.max(pages.data?.pages[0]?.lastSeq ?? 0, entries.at(-1)?.seq ?? 0));
  const last = entries.at(-1);
  const results = useMemo(
    () =>
      new Map(entries.flatMap((e) => (e.kind === TranscriptEntryKind.ToolResult ? [[e.data.callId, e] as const] : []))),
    [entries],
  );
  const turnStart = entries.findLast((e) => e.kind === TranscriptEntryKind.UserMessage)?.seq ?? -1;
  const writingKey =
    conversation.busy && last !== undefined && 'partId' in last && last.data.text !== '' ? keyOf(last) : undefined;
  const seconds = useMemo(() => thinkingSeconds(entries), [entries]);
  const ctx = useMemo<Rendered>(
    () => ({
      conversation,
      confirmations: new Map((confirmations ?? []).map((c) => [c.id, c])),
      results,
      pro,
      onContinue,
      turnStart,
      writingKey,
      seconds,
    }),
    [conversation, confirmations, results, pro, onContinue, turnStart, writingKey, seconds],
  );
  // Writing text or thinking shows itself and a running call its own shimmer; otherwise the panel shows it is thinking.
  const runningCall = last?.kind === TranscriptEntryKind.ToolCall && !results.has(last.data.callId);
  const thinking = conversation.busy && writingKey === undefined && !runningCall;
  const lastLength = last !== undefined && 'partId' in last ? last.data.text.length : 0;
  // Follows the newest message until the user scrolls up (25 §4.1).
  const liveCount = entries.filter((entry) => entry.seq > openedThrough).length;
  const stick = useStickToBottom(
    `${last?.seq}:${lastLength}:${conversation.busy}:${confirmations?.length ?? 0}`,
    liveCount,
  );
  const anchor = useRef<{ element: HTMLElement; top: number } | null>(null);
  const oldest = pages.data?.pages.at(-1);
  const loadOlder = () => {
    const element = stick.ref.current?.querySelector<HTMLElement>('[data-kind]');
    if (element) anchor.current = { element, top: element.offsetTop };
    void pages.fetchNextPage();
  };
  // 使用同一条消息的位置差，等待请求时用户的滚动和底部新来的回复都不会计入补偿。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在旧页插入后恢复锚点。
  useLayoutEffect(() => {
    const previous = anchor.current;
    if (previous && stick.ref.current && previous.element.isConnected) {
      stick.ref.current.scrollTop += previous.element.offsetTop - previous.top;
      anchor.current = null;
    }
  }, [oldest?.before, stick.ref]);

  if (entries.length === 0 && !conversation.busy)
    return (
      <div className={styles.feed}>
        <AssistantWelcome conversation={conversation} />
      </div>
    );
  return (
    <>
      <div className={styles.feed} ref={stick.ref} onScroll={stick.onScroll}>
        {pages.hasNextPage && (
          <Button size="sm" variant="ghost" pending={pages.isFetchingNextPage} onClick={loadOlder}>
            {C.earlierMessages}
          </Button>
        )}
        {pages.isFetchNextPageError && <ErrorState error={pages.error} onRetry={loadOlder} />}
        {entries.map((entry) => (
          <CatchBoundary key={keyOf(entry)} getResetKey={() => conversation.id} errorComponent={messageError}>
            <Message entry={entry} ctx={ctx} fresh={entry.seq > openedThrough} />
          </CatchBoundary>
        ))}
        {thinking && <Thinking queuePosition={conversation.queuePosition} />}
      </div>
      {!stick.following && <LatestButton unseen={stick.unseen} onClick={stick.toLatest} />}
    </>
  );
}

/** The conversation's message stream (15 §6), kept scrolled to the newest message. */
function ConversationHistory({ conversation }: { conversation: AssistantConversationDTO }) {
  const { pages, entries } = useAssistantHistory(conversation.id);
  if (pages.data === undefined)
    return (
      <div className={styles.feed}>
        {pages.isError ? (
          <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
        ) : (
          <p className="hint">{COMMON_COPY.loading}</p>
        )}
      </div>
    );
  return (
    <>
      <ContinuationSource conversation={conversation} />
      <Stream conversation={conversation} entries={entries} pages={pages} />
    </>
  );
}

export function MessageList({ conversation }: { conversation: AssistantConversationDTO }) {
  const historyError = useHistoryError(conversation.id, C.historyUnavailable);
  return (
    <CatchBoundary getResetKey={() => conversation.id} errorComponent={historyError}>
      <ConversationHistory conversation={conversation} />
    </CatchBoundary>
  );
}
