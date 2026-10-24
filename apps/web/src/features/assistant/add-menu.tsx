import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { Icon, type IconName } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import styles from './assistant.module.css';

export type AddMenuItem = { label: string; icon: IconName; onSelect: () => void };

/**
 * The input's「+」(36 §4): attachments and context in one menu opening upwards. The platform's popover gives light
 * dismiss, Esc and focus back to the button; arrow keys move between the items. `onOpen` runs as the button is
 * pressed, before the press can clear the page's selection.
 */
export function AddMenu({ items, onOpen }: { items: readonly AddMenuItem[]; onOpen: () => void }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const focusItem = (pick: (count: number, current: number) => number) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[pick(buttons.length, current)]?.focus();
  };
  // Opening moves focus to the first item. React does not deliver a popover's `toggle`, so it is listened to here.
  useEffect(() => {
    const el = menu.current;
    if (el === null) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const move: Partial<Record<string, (count: number, current: number) => number>> = {
      ArrowDown: (n, i) => (i + 1) % n,
      ArrowUp: (n, i) => (i - 1 + n) % n,
      Home: () => 0,
      End: (n) => n - 1,
    };
    const pick = move[e.key];
    if (pick === undefined) return;
    e.preventDefault();
    focusItem(pick);
  };
  return (
    <>
      <button
        type="button"
        className={styles.footIcon}
        popoverTarget={id}
        aria-haspopup="menu"
        aria-label={C.addMenu}
        title={C.addMenu}
        onPointerDown={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpen();
        }}
      >
        <Icon name="plus" size="sm" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className={styles.addMenu}
        role="menu"
        aria-label={C.addMenu}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              menu.current?.hidePopover();
              item.onSelect();
            }}
          >
            <Icon name={item.icon} size="sm" />
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
