import { AssistantPage } from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import styles from './assistant.module.css';
import { useCreateConversation, useSendMessage } from './assistant.queries.ts';

const C = ASSISTANT_COPY.home;

/** The home page's assistant input (15 §1): Enter opens the panel with a new conversation, next to「开始任务」. */
export function HomeAssistantInput() {
  const [text, setText] = useState('');
  const create = useCreateConversation();
  const send = useSendMessage();
  const open = (id: string) => useUiStore.setState({ assistantOpen: true, activeConversationId: id });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (message === '') return;
    create.mutate(undefined, {
      onSuccess: (conversation) => {
        open(conversation.id);
        send.mutate(
          { id: conversation.id, text: message, context: { page: AssistantPage.Home, params: {} } },
          { onSuccess: () => setText('') },
        );
      },
    });
  };

  return (
    <form onSubmit={submit} aria-label={C.label}>
      <div className={styles.homeAsk}>
        <input
          className="input grow"
          aria-label={C.label}
          placeholder={C.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" icon="sparkle" pending={create.isPending || send.isPending} disabled={text.trim() === ''}>
          {C.label}
        </Button>
      </div>
      {(create.isError || send.isError) && <ErrorState error={create.error ?? send.error} />}
    </form>
  );
}
