import {
  API_PREFIX,
  type AssistantConfirmationDTO,
  type AssistantConversationDTO,
  abortAssistantOp,
  assistantHistoryPageSchema,
  bindAssistantPreviewOp,
  cancelAssistantCallOp,
  confirmAssistantCallOp,
  createAssistantMemoryOp,
  createConversationOp,
  deleteConversationOp,
  ErrorCode,
  errorResponseSchema,
  listAssistantFilesOp,
  listConfirmationsOp,
  listConversationsOp,
  type PermissionDecision,
  previewAssistantFileOp,
  replyAssistantPermissionOp,
  type SendAssistantMessageRequest,
  sendAssistantMessageOp,
} from '@aw/shared';
import {
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, apiToken, callOperation, getJson } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { liveTranscriptQuery, type TranscriptSource, transcriptEntries } from '../attempts/attempt.queries.ts';

/** 与界面绑定更新串行：首次消息一定在它的当前预览关联写入后发送。 */
export const PREVIEW_BINDING_SCOPE = { id: 'assistant-preview-binding' };
export const useBindPreview = () =>
  useMutation({
    scope: PREVIEW_BINDING_SCOPE,
    mutationFn: (input: { id: string; preview: { taskId: string; tabId: string } | null }) =>
      callOperation(bindAssistantPreviewOp, input),
  });

export const conversationsQuery = queryOptions({
  queryKey: queryKeys.assistantConversations,
  queryFn: async () => (await callOperation(listConversationsOp, {})).items,
});

export const confirmationsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.assistantConfirmations(id),
    queryFn: async () => (await callOperation(listConfirmationsOp, { id })).items,
  });

export const assistantFilesQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.assistantFiles(id),
    queryFn: async () => (await callOperation(listAssistantFilesOp, { id })).items,
  });

export const assistantFilePreviewQuery = (id: string, path: string, sheet: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.assistantFilePreview(id, path, sheet),
    queryFn: () => callOperation(previewAssistantFileOp, { id, path, ...(sheet === undefined ? {} : { sheet }) }),
  });

/** A file the assistant wrote, as bytes to save (39 §8.2). */
export async function fetchAssistantFile(id: string, path: string): Promise<Uint8Array> {
  const res = await fetch(
    `${API_PREFIX}/assistant/conversations/${encodeURIComponent(id)}/files/raw?path=${encodeURIComponent(path)}`,
    { headers: { Authorization: `Bearer ${apiToken()}` } },
  );
  if (!res.ok) throw new ApiError(res.status, errorResponseSchema.parse(await res.json()).error);
  return new Uint8Array(await res.arrayBuffer());
}

export const conversationTranscript = (id: string): TranscriptSource => ({
  key: queryKeys.assistantTranscript(id),
  liveKey: queryKeys.assistantTranscriptLive(id),
  url: `${API_PREFIX}/assistant/conversations/${encodeURIComponent(id)}/history`,
});

/** 历史向前翻页，实时消息仍按 seq 接在文件快照之后。关闭聊天时释放已展开的旧页。 */
export function useAssistantHistory(id: string) {
  const source = conversationTranscript(id);
  const pages = useInfiniteQuery({
    queryKey: source.key,
    gcTime: 0,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      getJson(pageParam === null ? source.url : `${source.url}?before=${pageParam}`, assistantHistoryPageSchema),
    getNextPageParam: (oldest) => oldest.before,
  });
  const live = useQuery(liveTranscriptQuery(source));
  const entries = useMemo(
    () => (pages.data === undefined ? [] : transcriptEntries([...pages.data.pages].reverse(), live.data ?? [])),
    [pages.data, live.data],
  );
  return { pages, entries };
}

/**
 * SSE and mutations: a conversation's new state replaces it in the list, newest first. As with confirmations, a read
 * in flight is cancelled and repeated: answered before the change, it would bring back a conversation that is still
 * `busy` and the panel would keep waiting.
 */
export async function updateConversation(qc: QueryClient, conversation: AssistantConversationDTO): Promise<void> {
  const key = queryKeys.assistantConversations;
  await qc.cancelQueries({ queryKey: key, exact: true });
  qc.setQueryData<AssistantConversationDTO[]>(key, (old) =>
    old === undefined
      ? old
      : [conversation, ...old.filter((c) => c.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt),
  );
  await qc.invalidateQueries({ queryKey: key, exact: true });
}

/**
 * SSE and mutations: a confirmation card changed (created, confirmed, ran, cancelled). A read still in flight was
 * answered before the change and would overwrite it (the card of a just-sent message never showed), so it is
 * cancelled and the list read again, as `updateTask` does.
 */
export async function updateConfirmation(qc: QueryClient, confirmation: AssistantConfirmationDTO): Promise<void> {
  const key = queryKeys.assistantConfirmations(confirmation.conversationId);
  await qc.cancelQueries({ queryKey: key, exact: true });
  qc.setQueryData<AssistantConfirmationDTO[]>(key, (old) =>
    old === undefined
      ? old
      : [...old.filter((c) => c.id !== confirmation.id), confirmation].sort((a, b) => a.createdAt - b.createdAt),
  );
  await qc.invalidateQueries({ queryKey: key, exact: true });
  if (confirmation.operationId === createAssistantMemoryOp.id && confirmation.result?.ok)
    await qc.invalidateQueries({ queryKey: queryKeys.assistantMemories });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; projectId?: string | null } | undefined) =>
      callOperation(createConversationOp, input ?? {}),
    onSuccess: (c) => updateConversation(queryClient, c),
  });
}

// The conversation's busy state and permission requests arrive in order over SSE (`assistant.updated`). These
// responses are not written to the cache: one can arrive after the event saying the turn already ended.
export function useSendMessage() {
  const bind = useBindPreview();
  return useMutation({
    mutationFn: async (input: SendAssistantMessageRequest) => {
      const before = useUiStore.getState();
      let changed = false;
      // 连续离开再返回也算切换：旧消息不能借等待中的关联重新获得页面。
      const unsubscribe = useUiStore.subscribe((state) => {
        if (state.activePreview !== before.activePreview || state.activeConversationId !== before.activeConversationId)
          changed = true;
      });
      try {
        await bind.mutateAsync({ id: input.id, preview: before.activePreview });
        if (changed)
          throw new ApiError(409, {
            code: ErrorCode.AssistantContextChanged,
            message: 'The preview or conversation changed before the message was sent',
          });
        return callOperation(sendAssistantMessageOp, input);
      } finally {
        unsubscribe();
      }
    },
  });
}
export const useAbortAssistant = () =>
  useMutation({ mutationFn: (id: string) => callOperation(abortAssistantOp, { id }) });
export const useReplyAssistantPermission = () =>
  useMutation({
    mutationFn: (input: { id: string; permissionId: string; reply: PermissionDecision }) =>
      callOperation(replyAssistantPermissionOp, input),
  });

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteConversationOp, { id }),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<AssistantConversationDTO[]>(queryKeys.assistantConversations, (old) =>
        old?.filter((c) => c.id !== id),
      );
      queryClient.removeQueries({ queryKey: ['assistant', id] });
    },
  });
}

function useConfirmationMutation<I>(fn: (input: I) => Promise<AssistantConfirmationDTO>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (c) => updateConfirmation(queryClient, c) });
}

export const useConfirmCall = () =>
  useConfirmationMutation((input: { id: string; alwaysAllow: boolean }) =>
    callOperation(confirmAssistantCallOp, input.alwaysAllow ? input : { id: input.id }),
  );
export const useCancelCall = () =>
  useConfirmationMutation((id: string) => callOperation(cancelAssistantCallOp, { id }));
