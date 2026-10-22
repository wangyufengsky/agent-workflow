import { type ReactNode, useId, useRef } from 'react';
import styles from './git.module.css';

export type MenuItem = {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * A button opening a menu under it: the platform's popover gives light dismiss and Esc, CSS anchor positioning
 * places it at its invoker. `null` items draw a separator.
 */
export function GitMenu({
  label,
  className,
  trigger,
  items,
}: {
  label: string;
  className: string | undefined;
  trigger: ReactNode;
  items: ReadonlyArray<MenuItem | null>;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button" className={className} popoverTarget={id} aria-label={label} title={label}>
        {trigger}
      </button>
      <div ref={menu} id={id} popover="auto" className={styles.popover} role="menu" aria-label={label}>
        {items.map((item, i) =>
          item === null ? (
            // Separators have no identity of their own.
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the separator's identity
            <hr key={i} />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger === true ? styles.danger : undefined}
              disabled={item.disabled}
              onClick={() => {
                menu.current?.hidePopover();
                item.onSelect();
              }}
            >
              {item.label}
              {item.hint !== undefined && <small>{item.hint}</small>}
            </button>
          ),
        )}
      </div>
    </>
  );
}
