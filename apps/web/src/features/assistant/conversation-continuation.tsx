import {
  type AssistantConversationDTO,
  ATTACHMENTS_PER_INPUT_MAX,
  createAssistantContinuationOp,
  listAssistantAttachmentsOp,
} from '@aw/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_CONTINUATION_COPY as C } from '../../copy/assistant-continuation.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { updateConversation } from './assistant.queries.ts';
import styles from './conversation-continuation.module.css';

const ContinuationContext = createContext<{
  start: (() => void) | null;
  select: (id: string) => void;
} | null>(null);

export function useContinueConversation() {
  return useContext(ContinuationContext);
}

export const assistantAttachmentsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.assistantAttachments(id),
    queryFn: async () => (await callOperation(listAssistantAttachmentsOp, { id })).items,
  });

function ContinueDialog({
  conversation,
  onClose,
  onContinued,
}: {
  conversation: AssistantConversationDTO;
  onClose: () => void;
  onContinued: (id: string) => void;
}) {
  const attachments = useQuery(assistantAttachmentsQuery(conversation.id));
  const client = useQueryClient();
  const [requestId] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<string[]>([]);
  const continueChat = useMutation({
    mutationFn: () =>
      callOperation(createAssistantContinuationOp, { id: conversation.id, requestId, attachmentIds: selected }),
    onSuccess: async (child) => {
      await updateConversation(client, child);
      onContinued(child.id);
      onClose();
    },
  });
  const submitted = !continueChat.isIdle;
  return (
    <Dialog
      open
      title={C.action}
      description={C.description}
      onOpenChange={(open) => {
        if (!open && !continueChat.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" disabled={continueChat.isPending} onClick={onClose}>
            {COMMON_COPY.cancel}
          </Button>
          <Button variant="primary" pending={continueChat.isPending} onClick={() => continueChat.mutate()}>
            {continueChat.isError ? COMMON_COPY.retry : C.action}
          </Button>
        </>
      }
    >
      {attachments.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {attachments.isError && <ErrorState error={attachments.error} onRetry={() => void attachments.refetch()} />}
      {attachments.data !== undefined &&
        (attachments.data.length === 0 ? (
          <p className="hint">{C.noAttachments}</p>
        ) : (
          <fieldset className={styles.choices} disabled={submitted}>
            <legend>{C.attachmentChoices}</legend>
            {attachments.data.map((attachment) => {
              const checked = selected.includes(attachment.id);
              return (
                <label key={attachment.id} className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= ATTACHMENTS_PER_INPUT_MAX}
                    onChange={() =>
                      setSelected((ids) =>
                        checked ? ids.filter((id) => id !== attachment.id) : [...ids, attachment.id],
                      )
                    }
                  />
                  <span>{attachment.name}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
      {continueChat.isError && <ErrorState error={continueChat.error} />}
    </Dialog>
  );
}

export function ConversationContinuation({
  conversation,
  onContinued,
  children,
}: {
  conversation: AssistantConversationDTO | undefined;
  onContinued: (id: string) => void;
  children: ReactNode;
}) {
  const [source, setSource] = useState<AssistantConversationDTO>();
  return (
    <ContinuationContext.Provider
      value={{
        start: conversation === undefined || conversation.busy ? null : () => setSource(conversation),
        select: onContinued,
      }}
    >
      {children}
      {source !== undefined && (
        <ContinueDialog conversation={source} onClose={() => setSource(undefined)} onContinued={onContinued} />
      )}
    </ContinuationContext.Provider>
  );
}
