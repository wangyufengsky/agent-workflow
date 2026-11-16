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
import { Character } from '../companion/character.tsx';
import styles from './assistant.module.css';
import { conversationsQuery, useDeleteConversation } from './assistant.queries.ts';
import { AssistantWelcome } from './assistant-welcome.tsx';
import { Composer } from './composer.tsx';
import { ConversationContinuation } from './conversation-continuation.tsx';
import { ConversationMenu } from './conversation-menu.tsx';
import { MessageList } from './message-list.tsx';

/** The panel's content: conversations, the message stream and the input; Esc closes it. */
function Panel({ open, onClosed }: { open: boolean; onClosed: () => void }) {
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const activeId = useUiStore((s) => s.activeConversationId);
  const setActive = useUiStore((s) => s.setActiveConversation);
  const conversations = useQuery(conversationsQuery);
  const remove = useDeleteConversation();
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<{ activeId: string | null; projectId: string | null } | null>(null);
  const [initialized, setInitialized] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = conversations.data ?? [];
  // 缓存可能先出现新会话，再送出首条消息。空列表的输入框要保持草稿，直到发送成功并选中新会话。
  if (!initialized && conversations.isSuccess) {
    setInitialized(true);
    if (list.length === 0 && activeId === null) setDraft({ activeId, projectId: null });
  }
  const menuActive = list.find((c) => c.id === activeId) ?? list[0];
  const drafting = draft !== null && draft.activeId === activeId;
  const active = drafting ? undefined : menuActive;
  const busy = active?.busy === true;
  useEffect(() => {
    setDraft((current) => (current?.activeId === activeId ? current : null));
  }, [activeId]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <ConversationContinuation conversation={active} onContinued={setActive}>
      <aside
        className={styles.panel}
        data-state={open ? 'open' : 'closed'}
        data-busy={busy || undefined}
        inert={!open}
        aria-label={C.panel}
        onKeyDown={(e) => {
          // Portals and the switcher handle Esc without closing the panel underneath them.
          if (
            e.key === 'Escape' &&
            e.target instanceof Node &&
            e.currentTarget.contains(e.target) &&
            e.currentTarget.querySelector(':popover-open') === null
          )
            setOpen(false);
        }}
        onAnimationEnd={(e) => {
          if (!open && e.target === e.currentTarget) onClosed();
        }}
      >
        <header className={styles.head}>
          <Character mood={busy ? 'thinking' : undefined} />
          {menuActive === undefined ? (
            <span className={styles.headTitle}>{drafting ? C.newConversation : C.panel}</span>
          ) : (
            <ConversationMenu
              conversations={list}
              active={menuActive}
              draft={drafting}
              onSelect={(id) => {
                setDraft(null);
                setActive(id);
              }}
            />
          )}
          <span className="grow" />
          <IconButton icon="plus" label={C.newConversation} onClick={() => setDraft({ activeId, projectId: null })} />
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
            conversations.isSuccess && (
              <div className={styles.feed}>
                <AssistantWelcome conversation={undefined} projectId={drafting ? draft.projectId : null} />
              </div>
            )
          ) : (
            <MessageList key={active.id} conversation={active} />
          )}
        </div>
        <Composer
          key={active?.id ?? 'draft'}
          conversation={active}
          inputRef={input}
          disabled={conversations.isPending}
          projectId={drafting ? draft.projectId : null}
          onProjectChange={(projectId) => setDraft({ activeId, projectId })}
        />
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
    </ConversationContinuation>
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
