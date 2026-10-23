import type { AssistantConversationDTO } from '@aw/shared';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { useCreateConversation, useSendMessage } from './assistant.queries.ts';
import { useAssistantPage } from './assistant-page.ts';

/**
 * Sends a message with the page the user is on (15 §2) and shows its conversation: on the home page the page itself
 * shows it (`/?conversation=`, D112), elsewhere the panel does. It goes to `conversation`, or to a new one when that
 * is undefined. The composers, the welcome suggestions and the home page share it.
 */
export function useAsk() {
  const page = useAssistantPage();
  const onDesktop = window.location.pathname === '/companion';
  const onHome = useRouterState({ select: (s) => s.location.pathname === ROUTES.home });
  const navigate = useNavigate();
  const create = useCreateConversation();
  const send = useSendMessage();

  const sendTo = (
    target: AssistantConversationDTO,
    text: string,
    attachmentIds: readonly string[],
    onSent?: () => void,
  ) => {
    const message = {
      id: target.id,
      text,
      context: page,
      ...(attachmentIds.length === 0 ? {} : { attachmentIds: [...attachmentIds] }),
    };
    if (onHome) {
      // Only once the message is accepted: the input that sent it keeps the text and shows why it was not.
      send.mutate(message, {
        onSuccess: () => {
          onSent?.();
          useUiStore.setState({ activeConversationId: target.id });
          void navigate({ to: ROUTES.home, search: (s) => ({ projectId: s.projectId, conversation: target.id }) });
        },
      });
      return;
    }
    useUiStore.setState({ assistantOpen: !onDesktop, activeConversationId: target.id });
    send.mutate(message, { ...(onSent === undefined ? {} : { onSuccess: onSent }) });
  };
  /** `attachmentIds`: files sent with the message (30 §2). */
  const ask = (
    text: string,
    conversation: AssistantConversationDTO | undefined,
    onSent?: () => void,
    attachmentIds: readonly string[] = [],
  ) => {
    if (conversation === undefined)
      create.mutate(undefined, { onSuccess: (c) => sendTo(c, text, attachmentIds, onSent) });
    else sendTo(conversation, text, attachmentIds, onSent);
  };
  return {
    ask,
    isPending: create.isPending || send.isPending,
    error: create.isError ? create.error : send.isError ? send.error : null,
  };
}
