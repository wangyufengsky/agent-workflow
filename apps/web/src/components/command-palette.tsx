import * as RadixDialog from '@radix-ui/react-dialog';
import { type KeyboardEvent, useState } from 'react';
import { PALETTE_COPY } from '../copy/palette.ts';
import styles from './command-palette.module.css';
import { Icon } from './icon.tsx';

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run(): void;
};

function matches(item: PaletteItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(q);
}

type CommandPaletteProps = { open: boolean; onOpenChange: (open: boolean) => void; items: PaletteItem[] };

/** ⌘K skeleton (14 §2.1): filter, arrow keys, Enter runs the item and closes. Item sources live in the app shell. */
export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const visible = items.filter((item) => matches(item, query));
  const current = Math.min(active, Math.max(visible.length - 1, 0));

  const close = (next: boolean) => {
    if (!next) {
      setQuery('');
      setActive(0);
    }
    onOpenChange(next);
  };
  const run = (item: PaletteItem) => {
    close(false);
    item.run();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + visible.length) % Math.max(visible.length, 1));
    } else if (e.key === 'Enter') {
      const item = visible[current];
      if (item !== undefined) run(item);
    }
  };

  let lastGroup: string | undefined;
  return (
    <RadixDialog.Root open={open} onOpenChange={close}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="scrim" />
        <RadixDialog.Content className={styles.panel} aria-describedby={undefined}>
          <RadixDialog.Title className="sr">{PALETTE_COPY.title}</RadixDialog.Title>
          <div className={styles.search}>
            <Icon name="search" />
            <input
              className={styles.input}
              placeholder={PALETTE_COPY.placeholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={visible[current] === undefined ? undefined : `palette-${visible[current].id}`}
            />
          </div>
          <div id="palette-list" className={styles.list} role="listbox">
            {visible.length === 0 && <div className={styles.empty}>{PALETTE_COPY.empty}</div>}
            {visible.map((item, index) => {
              const header = item.group !== lastGroup ? <div className={styles.group}>{item.group}</div> : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header}
                  <button
                    type="button"
                    id={`palette-${item.id}`}
                    role="option"
                    aria-selected={index === current}
                    className={styles.item}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(item)}
                  >
                    {item.label}
                    {item.hint !== undefined && <span className={styles.hint}>{item.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
