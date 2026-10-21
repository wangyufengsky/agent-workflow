import type { AssistantConversationDTO } from '@aw/shared';
import { useUiStore } from '../../state/ui.store.ts';
import { useCreateConversation, useSendMessage } from './assistant.queries.ts';
import { useAssistantPage } from './assistant-page.ts';

/**
 * Sends a message with the page the user is on (15 §2) and shows its conversation in the panel: to `conversation`,
 * or to a new one when it is undefined. The composer, the welcome suggestions and the home page share it.
 */
export function useAsk() {
  const page = useAssistantPage();
  const create = useCreateConversation();
  const send = useSendMessage();

  const sendTo = (target: AssistantConversationDTO, text: string, onSent?: () => void) => {
    useUiStore.setState({ assistantOpen: true, activeConversationId: target.id });
    send.mutate({ id: target.id, text, context: page }, { ...(onSent === undefined ? {} : { onSuccess: onSent }) });
  };
  const ask = (text: string, conversation: AssistantConversationDTO | undefined, onSent?: () => void) => {
    if (conversation === undefined) create.mutate(undefined, { onSuccess: (c) => sendTo(c, text, onSent) });
    else sendTo(conversation, text, onSent);
  };
  return {
    ask,
    isPending: create.isPending || send.isPending,
    error: create.isError ? create.error : send.isError ? send.error : null,
  };
}
