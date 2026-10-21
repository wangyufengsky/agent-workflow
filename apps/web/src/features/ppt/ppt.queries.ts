import {
  type CreateDeckRequest,
  createDeckOp,
  type DeckDTO,
  deleteDeckOp,
  deleteSlideOp,
  generateDeckOp,
  getDeckOp,
  insertSlideOp,
  listDecksOp,
  moveSlideOp,
  restoreSlideOp,
  reviseOutlineOp,
  reviseSlidesOp,
  stopDeckOp,
  updateDeckOp,
  updateOutlineOp,
  updateSlideOp,
} from '@aw/shared';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { z } from 'zod';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

const FIRST_PAGE = '';

export const deckQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.deck(id), queryFn: () => callOperation(getDeckOp, { id }) });

export const deckPagesQuery = (filter: { projectId?: string; query?: string }) =>
  infiniteQueryOptions({
    queryKey: queryKeys.deckPages(filter),
    queryFn: ({ pageParam }) =>
      callOperation(listDecksOp, { ...filter, ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }) }),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** SSE `deck.updated` and PPT attempts' updates: the PPTs and their lists are read again. */
export const refreshDecks = (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.decks });

/** Every change returns the PPT: it replaces the cached one at once, the lists follow. */
function useDeckMutation<I>(mutationFn: (input: I) => Promise<DeckDTO>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (deck) => {
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      return refreshDecks(queryClient);
    },
  });
}

type Input<O extends { input: z.ZodType }> = z.input<O['input']>;

export const useCreateDeck = () => useDeckMutation((input: CreateDeckRequest) => callOperation(createDeckOp, input));
export const useUpdateDeck = () =>
  useDeckMutation((input: Input<typeof updateDeckOp>) => callOperation(updateDeckOp, input));
export const useReviseOutline = () =>
  useDeckMutation((input: Input<typeof reviseOutlineOp>) => callOperation(reviseOutlineOp, input));
export const useUpdateOutline = () =>
  useDeckMutation((input: Input<typeof updateOutlineOp>) => callOperation(updateOutlineOp, input));
export const useGenerateDeck = () =>
  useDeckMutation((input: Input<typeof generateDeckOp>) => callOperation(generateDeckOp, input));
export const useReviseSlides = () =>
  useDeckMutation((input: Input<typeof reviseSlidesOp>) => callOperation(reviseSlidesOp, input));
export const useUpdateSlide = () =>
  useDeckMutation((input: Input<typeof updateSlideOp>) => callOperation(updateSlideOp, input));
export const useRestoreSlide = () =>
  useDeckMutation((input: Input<typeof restoreSlideOp>) => callOperation(restoreSlideOp, input));
export const useInsertSlide = () =>
  useDeckMutation((input: Input<typeof insertSlideOp>) => callOperation(insertSlideOp, input));
export const useMoveSlide = () =>
  useDeckMutation((input: Input<typeof moveSlideOp>) => callOperation(moveSlideOp, input));
export const useDeleteSlide = () =>
  useDeckMutation((input: Input<typeof deleteSlideOp>) => callOperation(deleteSlideOp, input));
export const useStopDeck = () => useDeckMutation((id: string) => callOperation(stopDeckOp, { id }));

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteDeckOp, { id }),
    onSuccess: () => refreshDecks(queryClient),
  });
}
