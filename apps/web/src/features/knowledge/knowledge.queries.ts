import {
  type AskKnowledgeRequest,
  askKnowledgeOp,
  deleteKnowledgeOp,
  followUpKnowledgeOp,
  getKnowledgeOp,
  type KnowledgeConversationDTO,
  knowledgeCitationOp,
  listKnowledgeOp,
  stopKnowledgeOp,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

const FIRST_PAGE = '';

export const knowledgeConversationQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeConversation(id),
    queryFn: () => callOperation(getKnowledgeOp, { id }),
  });

export const knowledgePagesQuery = (filter: { projectId?: string; query?: string }) =>
  infiniteQueryOptions({
    queryKey: queryKeys.knowledgePages(filter),
    queryFn: ({ pageParam }) =>
      callOperation(listKnowledgeOp, { ...filter, ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }) }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const citationQuery = (turnId: string, index: number) =>
  queryOptions({
    queryKey: queryKeys.knowledgeCitation(turnId, index),
    queryFn: () => callOperation(knowledgeCitationOp, { turnId, index }),
  });

/** SSE `knowledge.updated` and research attempts' updates: conversations and lists are read again. */
export const refreshKnowledge = (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.knowledge });

function useConversationMutation<I>(mutationFn: (input: I) => Promise<KnowledgeConversationDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.knowledgeConversation(conversation.id), conversation);
      return refreshKnowledge(queryClient);
    },
  });
}

export const useAskKnowledge = () =>
  useConversationMutation((input: AskKnowledgeRequest) => callOperation(askKnowledgeOp, input));
export const useFollowUp = () =>
  useConversationMutation((input: { id: string; question: string }) => callOperation(followUpKnowledgeOp, input));
export const useStopKnowledge = () => useConversationMutation((id: string) => callOperation(stopKnowledgeOp, { id }));

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteKnowledgeOp, { id }),
    onSuccess: () => refreshKnowledge(queryClient),
  });
}
