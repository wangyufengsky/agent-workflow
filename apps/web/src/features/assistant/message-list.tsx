import {
  type AssistantConfirmationDTO,
  type AssistantConversationDTO,
  MCP_ASSISTANT_TOOL_PREFIX,
  PermissionDecision,
  type TranscriptEntry,
  TranscriptEntryKind,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTEMPT_COPY, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { useTranscript } from '../attempts/attempt.queries.ts';
import styles from './assistant.module.css';
import {
  assistantFilesQuery,
  confirmationsQuery,
  conversationTranscript,
  useReplyAssistantPermission,
} from './assistant.queries.ts';
import { ConfirmationCard } from './confirmation-card.tsx';
import { EntityCard } from './entity-card.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';

type ToolResult = Extract<TranscriptEntry, { kind: typeof TranscriptEntryKind.ToolResult }>;

const pretty = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
/** The app's tools read better without the MCP server prefix. */
const toolLabel = (tool: string) =>
  tool.startsWith(MCP_ASSISTANT_TOOL_PREFIX) ? tool.slice(MCP_ASSISTANT_TOOL_PREFIX.length) : tool;

/** A tool call and its result folded into one line (15 §6). */
function ToolLine({ call, result }: { call: TranscriptEntry & { kind: 'tool_call' }; result: ToolResult | undefined }) {
  const failed = result?.data.status === 'error';
  const label = toolLabel(call.data.tool);
  return (
    <details className={styles.line}>
      <summary className={failed ? styles.failed : undefined}>
        {failed ? C.toolFailed(label) : C.toolLine(label)}
      </summary>
      <pre className={styles.block}>{pretty(call.data.input)}</pre>
      {result !== undefined && (
        <pre className={styles.block}>{result.data.status === 'error' ? result.data.error : result.data.output}</pre>
      )}
    </details>
  );
}

function AttachmentCard({ conversationId, path }: { conversationId: string; path: string }) {
  const file = useQuery(assistantFilesQuery(conversationId)).data?.find((f) => f.path === path);
  const bridge = window.aw;
  return (
    <section className={styles.card} aria-label={C.attachment}>
      <div className={styles.cardTitle}>
        <Icon name="copy" />
        <span className="grow mono">{path}</span>
        {bridge !== undefined && file !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => void bridge.revealInFinder(file.absolutePath)}>
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
  if (!open) return <p className={styles.line}>{text}</p>;
  const answer = (decision: PermissionDecision) => reply.mutate({ id: conversation.id, permissionId, reply: decision });
  return (
    <section className={`${styles.card} ${styles.cardWait}`} aria-label={C.permissionTitle}>
      <div className={styles.cardTitle}>
        <Icon name="lock" />
        <span className="grow">{C.permissionTitle}</span>
      </div>
      <p className="mono">{text}</p>
      <div className={styles.actions}>
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
};

const Message = memo(function Message({ entry, ctx }: { entry: TranscriptEntry; ctx: Rendered }) {
  switch (entry.kind) {
    case TranscriptEntryKind.UserMessage:
      return (
        <div className={styles.user} data-testid="assistant-user-message">
          {entry.data.text}
        </div>
      );
    case TranscriptEntryKind.Text:
      return (
        <div className={styles.reply}>
          <ReplyMarkdown source={entry.data.text} />
        </div>
      );
    case TranscriptEntryKind.Reasoning:
      return (
        <details className={styles.line}>
          <summary>{ATTEMPT_COPY.reasoning}</summary>
          <p>{entry.data.text}</p>
        </details>
      );
    case TranscriptEntryKind.ToolCall:
      return <ToolLine call={entry} result={ctx.results.get(entry.data.callId)} />;
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
      return <p className={styles.line}>{TRANSCRIPT_SYSTEM_LABEL[entry.data.event]}</p>;
    case TranscriptEntryKind.Error:
      return (
        <p className={`${styles.line} ${styles.failed} mono`}>
          {entry.data.code} · {entry.data.message}
        </p>
      );
  }
});

/** The conversation's message stream (15 §6), kept scrolled to the newest message. */
export function MessageList({ conversation }: { conversation: AssistantConversationDTO }) {
  const { pages, entries } = useTranscript(conversationTranscript(conversation.id));
  const confirmations = useQuery(confirmationsQuery(conversation.id)).data;
  const end = useRef<HTMLDivElement>(null);
  const ctx = useMemo<Rendered>(
    () => ({
      conversation,
      confirmations: new Map((confirmations ?? []).map((c) => [c.id, c])),
      results: new Map(
        entries.flatMap((e) => (e.kind === TranscriptEntryKind.ToolResult ? [[e.data.callId, e] as const] : [])),
      ),
    }),
    [conversation, confirmations, entries],
  );
  const last = entries.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when a message arrives or grows.
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView; an effect may only return its clean-up.
    void end.current?.scrollIntoView({ block: 'end' });
  }, [entries.length, last, conversation.busy]);

  if (pages.data === undefined) {
    if (pages.isError) return <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />;
    return <p className="hint">{COMMON_COPY.loading}</p>;
  }
  return (
    <>
      {entries.length === 0 && <p className="hint">{C.empty}</p>}
      {entries.map((entry) => (
        <Message key={'partId' in entry ? entry.partId : entry.seq} entry={entry} ctx={ctx} />
      ))}
      {conversation.busy && <p className={styles.line}>{C.working}</p>}
      <div ref={end} />
    </>
  );
}
