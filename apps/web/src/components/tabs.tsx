import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export type TabItem = { value: string; label: string; content: ReactNode };

type TabsProps = { items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void };

/** Radix tabs (keyboard navigation, ARIA) styled with the `.tabs` / `.tab` classes. */
export function Tabs({ items, ...state }: TabsProps) {
  return (
    <RadixTabs.Root defaultValue={state.defaultValue ?? items[0]?.value} {...state}>
      <RadixTabs.List className="tabs">
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} className="tab">
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="tab-panel">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
