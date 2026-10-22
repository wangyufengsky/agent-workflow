import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import styles from './assistant.module.css';
import { conversationsQuery, useCreateConversation, useDeleteConversation } from './assistant.queries.ts';
import { AssistantWelcome } from './assistant-welcome.tsx';
import { Composer } from './composer.tsx';
import { ConversationMenu } from './conversation-menu.tsx';
import { MessageList } from './message-list.tsx';

/** The panel's content: conversations, the message stream and the input; Esc closes it. */
function Panel({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const activeId = useUiStore((s) => s.activeConversationId);
  const setActive = useUiStore((s) => s.setActiveConversation);
  const conversations = useQuery(conversationsQuery);
  const create = useCreateConversation();
  const remove = useDeleteConversation();
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = conversations.data ?? [];
  const active = list.find((c) => c.id === activeId) ?? list[0];
  const busy = active?.busy === true;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <aside
      className={styles.panel}
      data-state={open ? 'open' : 'closed'}
      data-busy={busy || undefined}
      inert={!open}
      aria-label={C.panel}
      onKeyDown={(e) => {
        // Esc in the open conversation list closes only the list.
        if (e.key === 'Escape' && e.currentTarget.querySelector(':popover-open') === null) setOpen(false);
      }}
      onAnimationEnd={(e) => {
        if (!open && e.target === e.currentTarget) onClosed();
      }}
    >
      <header className={styles.head}>
        <span className={styles.orb} data-busy={busy || undefined} aria-hidden="true" />
        {active === undefined ? (
          <span className={styles.headTitle}>{C.panel}</span>
        ) : (
          <ConversationMenu conversations={list} active={active} onSelect={setActive} />
        )}
        <span className="grow" />
        <IconButton
          icon="plus"
          label={C.newConversation}
          onClick={() => create.mutate(undefined, { onSuccess: (c) => setActive(c.id) })}
        />
        {active !== undefined && (
          <IconButton icon="trash" label={C.deleteConversation} onClick={() => setDeleting(true)} />
        )}
        <IconButton icon="x" label={C.close} onClick={() => setOpen(false)} />
      </header>
      <div className={styles.messages} data-testid="assistant-messages">
        {conversations.isError && (
          <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
        )}
        {active === undefined ? (
          conversations.isSuccess && <AssistantWelcome conversation={undefined} />
        ) : (
          <MessageList key={active.id} conversation={active} />
        )}
      </div>
      <Composer conversation={active} inputRef={input} />
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

/**
 * The global assistant panel (15 §6, D84): a frosted sheet floating over the page rather than a column beside it, so
 * pages keep their width. It stays mounted while it plays its closing animation, then unmounts. The home page shows
 * the conversation itself, so there the panel is closed (D112).
 */
export function AssistantPanel() {
  const onHome = useRouterState({ select: (s) => s.location.pathname === ROUTES.home });
  const open = useUiStore((s) => s.assistantOpen) && !onHome;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted ? <Panel open={open} onClosed={() => setMounted(false)} /> : null;
}
