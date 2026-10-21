import type { AssistantConversationDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import styles from './assistant.module.css';
import {
  conversationsQuery,
  useAbortAssistant,
  useCreateConversation,
  useDeleteConversation,
  useSendMessage,
} from './assistant.queries.ts';
import { useAssistantPage } from './assistant-page.ts';
import { MessageList } from './message-list.tsx';

const titleOf = (c: AssistantConversationDTO) => (c.title === '' ? C.untitled : c.title);

/** Input at the bottom: ⌘↵ sends with the page the user is on (15 §2); while the assistant works it can be stopped. */
function Composer({ conversation }: { conversation: AssistantConversationDTO | undefined }) {
  const [text, setText] = useState('');
  const page = useAssistantPage();
  const setActive = useUiStore((s) => s.setActiveConversation);
  const create = useCreateConversation();
  const send = useSendMessage();
  const abort = useAbortAssistant();
  const busy = conversation?.busy === true;

  const sendTo = (target: AssistantConversationDTO) => {
    setActive(target.id);
    send.mutate({ id: target.id, text: text.trim(), context: page }, { onSuccess: () => setText('') });
  };
  const submit = () => {
    if (text.trim() === '' || busy) return;
    if (conversation === undefined) create.mutate(undefined, { onSuccess: sendTo });
    else sendTo(conversation);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composer}>
      {send.isError && <ErrorState error={send.error} />}
      {create.isError && <ErrorState error={create.error} />}
      <textarea
        className="textarea"
        rows={3}
        aria-label={C.inputLabel}
        placeholder={C.inputPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.composerRow}>
        <span className="grow" />
        {busy && conversation !== undefined ? (
          <Button icon="stop" pending={abort.isPending} onClick={() => abort.mutate(conversation.id)}>
            {C.stop}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="sparkle"
            pending={send.isPending || create.isPending}
            disabled={text.trim() === ''}
            onClick={submit}
          >
            {C.send}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The global assistant panel (15 §6): conversations, the message stream and the input; Esc closes it. */
export function AssistantPanel() {
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const activeId = useUiStore((s) => s.activeConversationId);
  const setActive = useUiStore((s) => s.setActiveConversation);
  const conversations = useQuery(conversationsQuery);
  const create = useCreateConversation();
  const remove = useDeleteConversation();
  const [deleting, setDeleting] = useState(false);
  const list = conversations.data ?? [];
  const active = list.find((c) => c.id === activeId) ?? list[0];

  return (
    <aside
      className={styles.panel}
      aria-label={C.panel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <div className={styles.head}>
        <span className={styles.headTitle}>{C.panel}</span>
        <span className={styles.picker}>
          {active !== undefined && (
            <select
              className="select"
              aria-label={C.conversations}
              value={active.id}
              onChange={(e) => setActive(e.target.value)}
            >
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {titleOf(c)}
                </option>
              ))}
            </select>
          )}
        </span>
        <IconButton
          icon="plus"
          label={C.newConversation}
          onClick={() => create.mutate(undefined, { onSuccess: (c) => setActive(c.id) })}
        />
        {active !== undefined && (
          <IconButton icon="trash" label={C.deleteConversation} onClick={() => setDeleting(true)} />
        )}
        <IconButton icon="x" label={C.close} onClick={() => setOpen(false)} />
      </div>
      <div className={styles.messages} data-testid="assistant-messages">
        {conversations.isError && (
          <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
        )}
        {active === undefined ? <p className="hint">{C.empty}</p> : <MessageList conversation={active} />}
      </div>
      <Composer conversation={active} />
      {active !== undefined && deleting && (
        <Dialog
          open
          onOpenChange={setDeleting}
          title={C.deleteConversation}
          footer={
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() =>
                remove.mutate(active.id, {
                  onSuccess: () => {
                    setDeleting(false);
                    setActive(null);
                  },
                })
              }
            >
              {C.deleteConversation}
            </Button>
          }
        >
          <p>{C.deleteConfirm}</p>
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </aside>
  );
}
