import type { AssistantConversationDTO } from '@aw/shared';
import { useId, useRef } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ASSISTANT_CONTINUATION_COPY } from '../../copy/assistant-continuation.ts';
import { SKILLS_COPY } from '../../copy/skills.ts';
import { Character } from '../companion/character.tsx';
import styles from './assistant.module.css';
import { useContinueConversation } from './conversation-continuation.tsx';
import { useAsk } from './use-ask.ts';

export const titleOf = (c: AssistantConversationDTO) => (c.title === '' ? C.untitled : c.title);

/**
 * The panel's title doubles as the conversation switcher: a popover list under it (the platform's popover gives
 * light dismiss and Esc; CSS anchor positioning places it).
 */
export function ConversationMenu({
  conversations,
  active,
  onSelect,
  draft = false,
}: {
  conversations: readonly AssistantConversationDTO[];
  active: AssistantConversationDTO;
  onSelect: (id: string) => void;
  draft?: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const summarize = useAsk();
  const onContinue = useContinueConversation()?.start ?? null;
  return (
    <>
      <button type="button" className={styles.switcher} popoverTarget={id} aria-label={C.switchConversation}>
        <span className="ellipsis">{draft ? C.newConversation : titleOf(active)}</span>
        <span className={styles.switcherChevron} aria-hidden="true">
          <Icon name="chevRight" size="sm" />
        </span>
      </button>
      <div ref={menu} id={id} popover="auto" className={styles.menu} role="menu" aria-label={C.conversations}>
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitemradio"
            data-testid={`conversation-${c.id}`}
            aria-checked={!draft && c.id === active.id}
            className={styles.menuItem}
            onClick={() => {
              onSelect(c.id);
              menu.current?.hidePopover();
            }}
          >
            {c.continuation !== null && (
              <span
                role="img"
                aria-label={ASSISTANT_CONTINUATION_COPY.action}
                title={ASSISTANT_CONTINUATION_COPY.action}
              >
                <Icon name="split" size="sm" />
              </span>
            )}
            <span className="ellipsis grow">{titleOf(c)}</span>
            {c.busy && <Character size="xs" mood="thinking" />}
            {!draft && c.id === active.id && <Icon name="check" size="sm" />}
          </button>
        ))}
        {!draft && !active.busy && active.title !== '' && (
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={summarize.isPending}
            onClick={() => {
              menu.current?.hidePopover();
              summarize.ask(SKILLS_COPY.summarizeConversation, active);
            }}
          >
            <Icon name="sparkle" size="sm" />
            {SKILLS_COPY.summarize}
          </button>
        )}
        {onContinue !== null && (
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              menu.current?.hidePopover();
              onContinue();
            }}
          >
            <Icon name="split" size="sm" />
            {ASSISTANT_CONTINUATION_COPY.action}
          </button>
        )}
      </div>
      {summarize.error !== null && <ErrorState error={summarize.error} />}
    </>
  );
}
