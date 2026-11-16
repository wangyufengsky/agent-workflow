import {
  type AssistantConversationDTO,
  getAssistantContinuationHistoryOp,
  type TranscriptEntry,
  TranscriptEntryKind,
} from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_CONTINUATION_COPY as C } from '../../copy/assistant-continuation.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { transcriptEntries } from '../attempts/attempt.queries.ts';
import { conversationsQuery } from './assistant.queries.ts';
import styles from './conversation-continuation.module.css';
import { assistantAttachmentsQuery, useContinueConversation } from './conversation-continuation.tsx';
import { titleOf } from './conversation-menu.tsx';
import { ReplyMarkdown } from './reply-markdown.tsx';

function HistoryMessage({ entry }: { entry: TranscriptEntry }) {
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

function SourceHistory({ id }: { id: string }) {
  const history = useInfiniteQuery({
    queryKey: queryKeys.assistantContinuationHistory(id),
    queryFn: ({ pageParam }) => callOperation(getAssistantContinuationHistoryOp, { id, afterSeq: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.lastSeq : undefined),
  });
  const entries = useMemo(() => transcriptEntries(history.data?.pages ?? [], []), [history.data]);
  return (
    <>
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
          <HistoryMessage entry={entry} key={'partId' in entry ? entry.partId : entry.seq} />
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
  const attachments = useQuery({
    ...assistantAttachmentsQuery(conversation.id),
    enabled: continuation !== null && continuation.consumedAt === null,
  });
  if (continuation === null) return null;
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
      {continuation.consumedAt === null && attachments.isError && (
        <ErrorState error={attachments.error} onRetry={() => void attachments.refetch()} />
      )}
      {continuation.consumedAt === null && attachments.data !== undefined && attachments.data.length > 0 && (
        <div className={styles.carried}>
          <span className="hint">{C.carriedAttachments}</span>
          <SentAttachments attachments={attachments.data} />
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
          <SourceHistory id={conversation.id} />
        </Dialog>
      )}
    </section>
  );
}
