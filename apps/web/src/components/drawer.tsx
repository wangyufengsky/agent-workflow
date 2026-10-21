import * as RadixDialog from '@radix-ui/react-dialog';
import { type ReactNode, useRef } from 'react';
import { COMMON_COPY } from '../copy/common.ts';
import { IconButton } from './icon-button.tsx';

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: 'md' | 'lg' | 'xl' | 'wide';
  /** False keeps the page visible and usable beside the drawer: no scrim, clicks outside do not close it. */
  modal?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Side panel from the right, built on Radix Dialog for focus handling. Opening focuses the panel itself rather than
 * its first button, so the close button does not look selected; Tab reaches it as before.
 */
export function Drawer({ open, onOpenChange, title, size, modal = true, children, footer }: DrawerProps) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RadixDialog.Portal>
        {modal && <RadixDialog.Overlay className="scrim open" />}
        <RadixDialog.Content
          ref={content}
          className={size === undefined ? 'drawer open' : `drawer open ${size}`}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus();
          }}
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
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
