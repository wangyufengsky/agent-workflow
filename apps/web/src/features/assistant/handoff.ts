import { type AssistantConfirmationDTO, AssistantConfirmationStatus, type AssistantConversationDTO } from '@aw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { confirmationsQuery, conversationsQuery } from './assistant.queries.ts';

/**
 * Whether the panel takes over the home page's conversation when the user leaves the page on their own (D112): only
 * while the assistant is still answering or waits for a confirmation. Moves the assistant made itself open the
 * panel regardless (`followAssistant`).
 */
export function panelFollowsUser(
  conversation: AssistantConversationDTO | undefined,
  confirmations: readonly AssistantConfirmationDTO[] | undefined,
): boolean {
  if (conversation === undefined) return false;
  return conversation.busy || (confirmations ?? []).some((c) => c.status === AssistantConfirmationStatus.Pending);
}

/**
 * The assistant takes the user to another page (a card's「打开」, `open_page`, a link in its answer): the panel opens
 * on the same conversation (D112), with its own entrance also when leaving the home page (D189).
 */
export function followAssistant(go: () => Promise<unknown>): void {
  useUiStore.setState({ assistantOpen: true });
  void go();
}

/**
 * Hands the conversation between the home page and the panel as the user moves (D112): leaving home on their own
 * opens the panel when `panelFollowsUser`; coming home with the panel open closes it and shows its conversation on
 * the page.
 */
export function useAssistantHandoff(): void {
  const location = useRouterState({ select: (s) => s.location });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const previous = useRef(location);

  useEffect(() => {
    const before = previous.current;
    previous.current = location;
    const wasHome = before.pathname === ROUTES.home;
    const isHome = location.pathname === ROUTES.home;
    const ui = useUiStore.getState();
    if (wasHome && !isHome) {
      const id = before.search.conversation;
      if (id === undefined || ui.assistantOpen) return;
      const conversation = queryClient.getQueryData(conversationsQuery.queryKey)?.find((c) => c.id === id);
      if (panelFollowsUser(conversation, queryClient.getQueryData(confirmationsQuery(id).queryKey))) {
        useUiStore.setState({ assistantOpen: true, activeConversationId: id });
      }
    } else if (!wasHome && isHome && ui.assistantOpen) {
      useUiStore.setState({ assistantOpen: false });
      const id = ui.activeConversationId ?? queryClient.getQueryData(conversationsQuery.queryKey)?.[0]?.id;
      if (id !== undefined && location.search.conversation === undefined) {
        void navigate({ to: ROUTES.home, search: (s) => ({ ...s, conversation: id }), replace: true });
      }
    }
  }, [location, queryClient, navigate]);
}
