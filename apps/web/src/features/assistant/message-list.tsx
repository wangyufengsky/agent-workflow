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
import { useQuery } from '@tanstack/react-query';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTEMPT_COPY, STREAM_COPY, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { useTranscript } from '../attempts/attempt.queries.ts';
import { Character } from '../companion/character.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { LatestButton } from '../stream/latest-button.tsx';
import { thinkingSeconds } from '../stream/stream-items.ts';
import { ThinkingBlock } from '../stream/thinking-block.tsx';
import { useStickToBottom } from '../stream/use-stick-to-bottom.ts';
import styles from './assistant.module.css';
import {
  assistantFilesQuery,
  confirmationsQuery,
  conversationTranscript,
  useReplyAssistantPermission,
} from './assistant.queries.ts';
import { AssistantWelcome } from './assistant-welcome.tsx';
import cards from './cards.module.css';
import { ChartCard } from './chart-card.tsx';
import { ConfirmationCard } from './confirmation-card.tsx';
import { EntityCard } from './entity-card.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';
import { type ToolResult, ToolRow } from './tool-row.tsx';

/** The newest messages of a conversation as it opens fade in one after another (`data-step` delays, assistant.module.css). */
const STAGGER_STEPS = 6;

/** A call that waits for the user shows as its confirmation card, not as a row of its own (15 §4). */
function waitsForConfirmation(tool: string, result: ToolResult | undefined): boolean {
  // Only the app's own tools answer with JSON (assistant.tools.ts); other tools may print anything.
  if (!tool.startsWith(MCP_ASSISTANT_TOOL_PREFIX)) return false;
  if (result?.data.status !== 'completed' || result.data.output === undefined) return false;
  return needsConfirmationOutputSchema.safeParse(JSON.parse(result.data.output)).success;
}

const CHART_TOOLS: ReadonlySet<string> = new Set(
  [AssistantToolName.ShowChart, AssistantToolName.ShowFlowchart].map((name) => `${MCP_ASSISTANT_TOOL_PREFIX}${name}`),
);

/** In simple mode a chart stands for the call that drew it; a failed call still shows (35 §5.4). */
function drewChart(tool: string, result: ToolResult | undefined): boolean {
  return CHART_TOOLS.has(tool) && result?.data.status === 'completed';
}

function AttachmentCard({ conversationId, path }: { conversationId: string; path: string }) {
  const file = useQuery(assistantFilesQuery(conversationId)).data?.find((f) => f.path === path);
  const bridge = window.aw;
  return (
    <section className={`${cards.card} ${cards.linkCard}`} aria-label={C.attachment}>
      <div className={cards.cardHead}>
        <span className={cards.tile} aria-hidden="true">
          <Icon name="copy" size="sm" />
        </span>
        <span className={cards.cardHeading}>
          <span className={cards.eyebrow}>{C.attachment}</span>
          <span className={`${cards.cardTitle} ellipsis`}>{path}</span>
        </span>
        {bridge !== undefined && file !== undefined && (
          <Button size="sm" onClick={() => void bridge.revealInFinder(file.absolutePath)}>
            {C.reveal}
          </Button>
        )}
      </div>
    </section>
  );
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
  const open = conversation.pendingPermissions.some((p) => p.permissionId === permissionId);
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
      <pre className={cards.json}>{text}</pre>
      <div className={cards.actions}>
        <Button size="sm" variant="primary" disabled={reply.isPending} onClick={() => answer(PermissionDecision.Once)}>
          {C.permissionAllowOnce}
        </Button>
        <Button size="sm" disabled={reply.isPending} onClick={() => answer(PermissionDecision.Always)}>
          {C.permissionAlways}
        </Button>
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
      return <ToolRow call={entry} result={result} busy={running} pro={ctx.pro} />;
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
      return <AttachmentCard conversationId={ctx.conversation.id} path={entry.data.path} />;
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
      return (
        <div className={styles.error} role="status">
          <Icon name="alert" size="sm" />
          <span className="grow">
            <span className={styles.errorTitle}>{ERROR_COPY[entry.data.code]}</span>
            {typeof said === 'string' && <span className={styles.errorMessage}>{said}</span>}
            {ctx.pro && (
              <span className={`${styles.errorMessage} mono`}>
                {entry.data.code} · {entry.data.message}
              </span>
            )}
          </span>
        </div>
      );
    }
  }
}

const Message = memo(function Message({
  entry,
  ctx,
  step,
  fresh,
}: {
  entry: TranscriptEntry;
  ctx: Rendered;
  step: number;
  /** Arrived after the conversation opened: a chart grows in (35 §5.4). */
  fresh: boolean;
}) {
  const body = Body({ entry, ctx, fresh });
  if (body === null) return null;
  return (
    <div className={styles.message} data-kind={entry.kind} data-step={step}>
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
}: {
  conversation: AssistantConversationDTO;
  entries: readonly TranscriptEntry[];
}) {
  const confirmations = useQuery(confirmationsQuery(conversation.id)).data;
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  // What was there when the conversation opened is staggered; what arrives later fades in at once.
  const [opened] = useState(entries.length);
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
      turnStart,
      writingKey,
      seconds,
    }),
    [conversation, confirmations, results, pro, turnStart, writingKey, seconds],
  );
  // Writing text or thinking shows itself and a running call its own shimmer; otherwise the panel shows it is thinking.
  const runningCall = last?.kind === TranscriptEntryKind.ToolCall && !results.has(last.data.callId);
  const thinking = conversation.busy && writingKey === undefined && !runningCall;
  const lastLength = last !== undefined && 'partId' in last ? last.data.text.length : 0;
  // Follows the newest message until the user scrolls up (25 §4.1).
  const stick = useStickToBottom(
    `${entries.length}:${lastLength}:${conversation.busy}:${confirmations?.length ?? 0}`,
    entries.length,
  );

  if (entries.length === 0 && !conversation.busy)
    return (
      <div className={styles.feed}>
        <AssistantWelcome conversation={conversation} />
      </div>
    );
  return (
    <>
      <div className={styles.feed} ref={stick.ref} onScroll={stick.onScroll}>
        {entries.map((entry, i) => (
          <Message
            key={keyOf(entry)}
            entry={entry}
            ctx={ctx}
            step={i < opened ? Math.max(0, STAGGER_STEPS - (opened - i)) : 0}
            fresh={i >= opened}
          />
        ))}
        {thinking && <Thinking queuePosition={conversation.queuePosition} />}
      </div>
      {!stick.following && <LatestButton unseen={stick.unseen} onClick={stick.toLatest} />}
    </>
  );
}

/** The conversation's message stream (15 §6), kept scrolled to the newest message. */
export function MessageList({ conversation }: { conversation: AssistantConversationDTO }) {
  const { pages, entries } = useTranscript(conversationTranscript(conversation.id));
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
  return <Stream conversation={conversation} entries={entries} />;
}
