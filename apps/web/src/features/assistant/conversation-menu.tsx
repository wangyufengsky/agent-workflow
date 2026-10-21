import type { AssistantConversationDTO } from '@aw/shared';
import { useId, useRef } from 'react';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import styles from './assistant.module.css';

export const titleOf = (c: AssistantConversationDTO) => (c.title === '' ? C.untitled : c.title);

/**
 * The panel's title doubles as the conversation switcher: a popover list under it (the platform's popover gives
 * light dismiss and Esc; CSS anchor positioning places it).
 */
export function ConversationMenu({
  conversations,
  active,
  onSelect,
}: {
  conversations: readonly AssistantConversationDTO[];
  active: AssistantConversationDTO;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button" className={styles.switcher} popoverTarget={id} aria-label={C.switchConversation}>
        <span className="ellipsis">{titleOf(active)}</span>
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
            aria-checked={c.id === active.id}
            className={styles.menuItem}
            onClick={() => {
              onSelect(c.id);
              menu.current?.hidePopover();
            }}
          >
            <span className="ellipsis grow">{titleOf(c)}</span>
            {c.busy && <span className={styles.orb} data-busy data-size="sm" aria-hidden="true" />}
            {c.id === active.id && <Icon name="check" size="sm" />}
          </button>
        ))}
      </div>
    </>
  );
}
