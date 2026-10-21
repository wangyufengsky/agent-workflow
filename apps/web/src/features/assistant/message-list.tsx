import {
  type AssistantConfirmationDTO,
  type AssistantConversationDTO,
  needsConfirmationOutputSchema,
  PermissionDecision,
  type TranscriptEntry,
  TranscriptEntryKind,
  UiMode,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTEMPT_COPY, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { useTranscript } from '../attempts/attempt.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import styles from './assistant.module.css';
import {
  assistantFilesQuery,
  confirmationsQuery,
  conversationTranscript,
  useReplyAssistantPermission,
} from './assistant.queries.ts';
import { AssistantWelcome } from './assistant-welcome.tsx';
import cards from './cards.module.css';
import { ConfirmationCard } from './confirmation-card.tsx';
import { EntityCard } from './entity-card.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';
import { type ToolResult, ToolRow } from './tool-row.tsx';

/** The newest messages of a conversation as it opens fade in one after another (`data-step` delays, assistant.module.css). */
const STAGGER_STEPS = 6;

/** A call that waits for the user shows as its confirmation card, not as a row of its own (15 §4). */
function waitsForConfirmation(result: ToolResult | undefined): boolean {
  if (result?.data.status !== 'completed' || result.data.output === undefined) return false;
  // Only the app's tools answer with JSON; other output never starts an object.
  if (!result.data.output.startsWith('{')) return false;
  return needsConfirmationOutputSchema.safeParse(JSON.parse(result.data.output)).success;
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
  /** The text the assistant is writing right now gets a typing caret. */
  streamingKey: string | number | undefined;
};

const keyOf = (entry: TranscriptEntry) => ('partId' in entry ? entry.partId : entry.seq);

function Body({ entry, ctx }: { entry: TranscriptEntry; ctx: Rendered }): ReactNode {
  switch (entry.kind) {
    case TranscriptEntryKind.UserMessage:
      return (
        <div className={styles.user} data-testid="assistant-user-message">
          {entry.data.text}
        </div>
      );
    case TranscriptEntryKind.Text:
      return (
        <div className={ctx.streamingKey === keyOf(entry) ? `${styles.reply} ${styles.streaming}` : styles.reply}>
          <ReplyMarkdown source={entry.data.text} />
        </div>
      );
    case TranscriptEntryKind.Reasoning:
      return (
        <details className={cards.action}>
          <summary className={cards.actionHead}>
            <span className={cards.actionIcon} aria-hidden="true">
              <Icon name="sparkle" size="sm" />
            </span>
            <span className={cards.actionTitle}>{C.reasoning}</span>
            <span className={cards.actionChevron} aria-hidden="true">
              <Icon name="chevRight" size="sm" />
            </span>
          </summary>
          <p className={cards.actionBody}>{entry.data.text}</p>
        </details>
      );
    case TranscriptEntryKind.ToolCall: {
      const result = ctx.results.get(entry.data.callId);
      if (waitsForConfirmation(result)) return null;
      return <ToolRow call={entry} result={result} busy={ctx.conversation.busy} pro={ctx.pro} />;
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
    case TranscriptEntryKind.System:
      return <p className={styles.system}>{TRANSCRIPT_SYSTEM_LABEL[entry.data.event]}</p>;
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

const Message = memo(function Message({ entry, ctx, step }: { entry: TranscriptEntry; ctx: Rendered; step: number }) {
  const body = Body({ entry, ctx });
  if (body === null) return null;
  return (
    <div className={styles.message} data-kind={entry.kind} data-step={step}>
      {body}
    </div>
  );
});

/** The working indicator (15 §6): the assistant's mark turning and a line of light passing over the words. */
function Thinking() {
  return (
    <div className={`${styles.message} ${styles.thinking}`} role="status" data-testid="assistant-thinking">
      <span className={styles.orb} data-busy aria-hidden="true" />
      <span className={cards.shimmer}>{C.thinking}</span>
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
  const end = useRef<HTMLDivElement>(null);
  const last = entries.at(-1);
  const results = useMemo(
    () =>
      new Map(entries.flatMap((e) => (e.kind === TranscriptEntryKind.ToolResult ? [[e.data.callId, e] as const] : []))),
    [entries],
  );
  const streamingKey =
    conversation.busy && last?.kind === TranscriptEntryKind.Text && last.data.text !== '' ? keyOf(last) : undefined;
  const ctx = useMemo<Rendered>(
    () => ({
      conversation,
      confirmations: new Map((confirmations ?? []).map((c) => [c.id, c])),
      results,
      pro,
      streamingKey,
    }),
    [conversation, confirmations, results, pro, streamingKey],
  );
  // Writing text shows its caret and a running call its own shimmer; otherwise the panel shows it is thinking.
  const runningCall = last?.kind === TranscriptEntryKind.ToolCall && !results.has(last.data.callId);
  const thinking = conversation.busy && streamingKey === undefined && !runningCall;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when a message arrives or grows.
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView; an effect may only return its clean-up.
    void end.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, last, conversation.busy, confirmations]);

  if (entries.length === 0 && !conversation.busy) return <AssistantWelcome conversation={conversation} />;
  return (
    <>
      {entries.map((entry, i) => (
        <Message
          key={keyOf(entry)}
          entry={entry}
          ctx={ctx}
          step={i < opened ? Math.max(0, STAGGER_STEPS - (opened - i)) : 0}
        />
      ))}
      {thinking && <Thinking />}
      <div ref={end} />
    </>
  );
}

/** The conversation's message stream (15 §6), kept scrolled to the newest message. */
export function MessageList({ conversation }: { conversation: AssistantConversationDTO }) {
  const { pages, entries } = useTranscript(conversationTranscript(conversation.id));
  if (pages.data === undefined) {
    if (pages.isError) return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
    return <p className="hint">{COMMON_COPY.loading}</p>;
  }
  return <Stream conversation={conversation} entries={entries} />;
}
