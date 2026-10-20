import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { COMMON_COPY } from '../copy/common.ts';
import { IconButton } from './icon-button.tsx';

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: 'md' | 'lg' | 'xl' | 'wide';
  children: ReactNode;
  footer?: ReactNode;
};

/** Side panel from the right, built on Radix Dialog for focus handling. */
export function Drawer({ open, onOpenChange, title, size, children, footer }: DrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="scrim open" />
        <RadixDialog.Content
          className={size === undefined ? 'drawer open' : `drawer open ${size}`}
          aria-describedby={undefined}
        >
          <div className="drawer-head">
            <RadixDialog.Title className="grow">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton icon="x" label={COMMON_COPY.close} />
            </RadixDialog.Close>
          </div>
          <div className="drawer-body">{children}</div>
          {footer !== undefined && <div className="drawer-foot">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
