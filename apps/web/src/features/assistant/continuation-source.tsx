import {
  type AssistantConfirmationDTO,
  type AssistantConversationDTO,
  getAssistantContinuationHistoryOp,
  OPERATION_CONTRACTS,
  type TranscriptEntry,
  TranscriptEntryKind,
  UiMode,
} from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { CONFIRMATION_COPY } from '../../copy/assistant.ts';
import { ASSISTANT_CONTINUATION_COPY as C } from '../../copy/assistant-continuation.ts';
import { ATTEMPT_COPY, STREAM_COPY, TRANSCRIPT_SYSTEM_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { operationTitle } from '../../copy/operations.ts';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { transcriptEntries } from '../attempts/attempt.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { thinkingSeconds } from '../stream/stream-items.ts';
import { ThinkingBlock } from '../stream/thinking-block.tsx';
import { confirmationsQuery, conversationsQuery } from './assistant.queries.ts';
import { ChartCard } from './chart-card.tsx';
import styles from './conversation-continuation.module.css';
import { assistantAttachmentsQuery, useContinueConversation } from './conversation-continuation.tsx';
import { titleOf } from './conversation-menu.tsx';
import { InputSummary } from './input-summary.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';
import { describeTool } from './tool-label.ts';
import { type ToolResult, ToolRow } from './tool-row.tsx';

function HistoryConfirmation({ confirmation, id }: { confirmation: AssistantConfirmationDTO | undefined; id: string }) {
  if (confirmation === undefined) return <p className="hint">{C.confirmationUnavailable(id)}</p>;
  const operation = OPERATION_CONTRACTS.find((item) => item.id === confirmation.operationId);
  return (
    <section aria-label={C.historicalConfirmation} data-testid="historical-confirmation">
      <strong>
        {C.historicalConfirmation}：{operationTitle(confirmation.title)}
      </strong>
      <p>{C.currentSourceStatus(CONFIRMATION_COPY.status[confirmation.status])}</p>
      {operation !== undefined && <InputSummary operation={operation} input={confirmation.input} />}
    </section>
  );
}

function HistoryMessage({
  entry,
  results,
  confirmations,
  pro,
  seconds,
}: {
  entry: TranscriptEntry;
  results: ReadonlyMap<string, ToolResult>;
  confirmations: ReadonlyMap<string, AssistantConfirmationDTO>;
  pro: boolean;
  seconds: ReadonlyMap<string, number>;
}) {
  switch (entry.kind) {
    case TranscriptEntryKind.UserMessage:
      return (
        <li className={styles.historyMessage}>
          <strong>{C.user}</strong>
          <div className={styles.userText}>{entry.data.text}</div>
          {entry.data.attachments !== undefined && <SentAttachments attachments={entry.data.attachments} />}
        </li>
      );
    case TranscriptEntryKind.Text:
      if (entry.data.text.trim() === '') return null;
      return (
        <li className={styles.historyMessage}>
          <strong>{C.assistant}</strong>
          <ReplyMarkdown source={entry.data.text} />
        </li>
      );
    case TranscriptEntryKind.Reasoning:
      return (
        <li>
          <ThinkingBlock text={entry.data.text} seconds={seconds.get(entry.partId)} writing={false} />
        </li>
      );
    case TranscriptEntryKind.ToolCall: {
      const result = results.get(entry.data.callId);
      if (result === undefined)
        return (
          <li className="hint">
            {describeTool(entry.data.tool, entry.data.input).title} · {C.resultNotLoaded}
          </li>
        );
      return (
        <li>
          <ToolRow call={entry} result={result} busy={false} pro={pro} />
        </li>
      );
    }
    case TranscriptEntryKind.ToolResult:
      return null;
    case TranscriptEntryKind.Permission:
      return (
        <li className="hint">
          {C.historicalPermission} · {ATTEMPT_COPY.permission(entry.data.permission, entry.data.patterns.join(' '))}
        </li>
      );
    case TranscriptEntryKind.Confirmation:
      return (
        <li>
          <HistoryConfirmation
            id={entry.data.confirmationId}
            confirmation={confirmations.get(entry.data.confirmationId)}
          />
        </li>
      );
    case TranscriptEntryKind.Chart:
      return (
        <li>
          <ChartCard chart={entry.data.chart} fresh={false} />
        </li>
      );
    case TranscriptEntryKind.System: {
      const label = TRANSCRIPT_SYSTEM_LABEL[entry.data.event];
      return (
        <li className="hint">
          {entry.data.detail === undefined ? label : STREAM_COPY.noticeDetail(label, entry.data.detail)}
        </li>
      );
    }
    case TranscriptEntryKind.Error:
      return <li className="hint">{ERROR_COPY[entry.data.code]}</li>;
    case TranscriptEntryKind.EntityRef:
      return <li className="hint">{entry.data.title}</li>;
    case TranscriptEntryKind.Attachment:
      return <li className="hint">{entry.data.path}</li>;
    default:
      return null;
  }
}

function SourceHistory({ id, sourceId }: { id: string; sourceId: string }) {
  const confirmations = useQuery(confirmationsQuery(sourceId));
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const history = useInfiniteQuery({
    queryKey: queryKeys.assistantContinuationHistory(id),
    queryFn: ({ pageParam }) => callOperation(getAssistantContinuationHistoryOp, { id, afterSeq: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.lastSeq : undefined),
  });
  const entries = useMemo(() => transcriptEntries(history.data?.pages ?? [], []), [history.data]);
  const results = useMemo(
    () =>
      new Map(
        entries.flatMap((entry) =>
          entry.kind === TranscriptEntryKind.ToolResult ? [[entry.data.callId, entry] as const] : [],
        ),
      ),
    [entries],
  );
  const confirmationMap = useMemo(
    () => new Map((confirmations.data ?? []).map((item) => [item.id, item])),
    [confirmations.data],
  );
  const seconds = useMemo(() => thinkingSeconds(entries), [entries]);
  return (
    <>
      {confirmations.isError && <ErrorState error={confirmations.error} onRetry={() => void confirmations.refetch()} />}
      {history.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {history.isError && (
        <ErrorState
          error={history.error}
          onRetry={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}
        />
      )}
      {history.isSuccess && entries.length === 0 && <p className="hint">{C.empty}</p>}
      <ol className={styles.history}>
        {entries.map((entry) => (
          <HistoryMessage
            entry={entry}
            results={results}
            confirmations={confirmationMap}
            pro={pro}
            seconds={seconds}
            key={'partId' in entry ? entry.partId : entry.seq}
          />
        ))}
      </ol>
      {history.hasNextPage && (
        <Button size="sm" pending={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          {C.more}
        </Button>
      )}
    </>
  );
}

/** 续接前的消息独立读取，旧会话的操作卡和授权不会成为当前对话的操作。 */
export function ContinuationSource({ conversation }: { conversation: AssistantConversationDTO }) {
  const [open, setOpen] = useState(false);
  const choose = useContinueConversation()?.select;
  const conversations = useQuery(conversationsQuery).data;
  const { continuation } = conversation;
  const hasCarriedAttachments = continuation !== null && continuation.attachmentIds.length > 0;
  const attachments = useQuery({
    ...assistantAttachmentsQuery(conversation.id),
    enabled: hasCarriedAttachments,
  });
  if (continuation === null) return null;
  const carriedAttachments = attachments.data?.filter((attachment) =>
    continuation.attachmentIds.includes(attachment.id),
  );
  const source = conversations?.find((item) => item.id === continuation.sourceConversationId);
  const description = continuation.sourceAvailable
    ? C.source(source === undefined ? continuation.sourceConversationId : titleOf(source), continuation.createdAt)
    : C.sourceUnavailable(continuation.createdAt);
  return (
    <section className={styles.source} data-testid="continuation-source">
      <Icon name="split" size="sm" />
      <div className={styles.sourceText}>
        <div>{description}</div>
        {continuation.handoffKind === 'recent' && <div className="hint">{C.recentOnly}</div>}
        {continuation.draftText !== null && <div className="hint">{C.recoveredDraft}</div>}
      </div>
      {continuation.sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {C.history}
        </Button>
      )}
      {hasCarriedAttachments && attachments.isError && (
        <ErrorState error={attachments.error} onRetry={() => void attachments.refetch()} />
      )}
      {carriedAttachments !== undefined && carriedAttachments.length > 0 && (
        <div className={styles.carried}>
          <span className="hint">{C.carriedAttachments}</span>
          <SentAttachments attachments={carriedAttachments} />
        </div>
      )}
      {open && continuation.sourceAvailable && (
        <Dialog
          open
          onOpenChange={setOpen}
          title={C.history}
          description={description}
          footer={
            <>
              {choose !== undefined && (
                <Button variant="ghost" onClick={() => choose(continuation.sourceConversationId)}>
                  {C.openSource}
                </Button>
              )}
              <Button onClick={() => setOpen(false)}>{COMMON_COPY.close}</Button>
            </>
          }
        >
          <SourceHistory id={conversation.id} sourceId={continuation.sourceConversationId} />
        </Dialog>
      )}
    </section>
  );
}
