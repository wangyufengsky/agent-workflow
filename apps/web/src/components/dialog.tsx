import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

/** Modal dialog; Radix traps and restores focus and closes on Escape (06 §8). */
export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="scrim" />
        <RadixDialog.Content
          className="dialog"
          aria-describedby={description === undefined ? undefined : 'dialog-desc'}
        >
          <div className="dialog-body">
            <RadixDialog.Title>{title}</RadixDialog.Title>
            {description !== undefined && (
              <RadixDialog.Description id="dialog-desc">{description}</RadixDialog.Description>
            )}
            {children}
          </div>
          {footer !== undefined && <div className="dialog-foot">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
