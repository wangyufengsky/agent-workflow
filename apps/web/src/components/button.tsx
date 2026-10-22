import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './icon.tsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'brand' | 'danger';
  size?: 'sm' | 'lg' | undefined;
  icon?: IconName;
  /** Shows a spinner and disables the button while a request runs (11 §1: no duplicate submits). */
  pending?: boolean;
};

export function Button({
  variant = 'secondary',
  size,
  icon,
  pending = false,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const className = ['btn', variant, size].filter(Boolean).join(' ');
  return (
    <button type="button" className={className} disabled={disabled === true || pending} {...rest}>
      {pending ? <span className="spin" aria-hidden="true" /> : icon !== undefined && <Icon name={icon} />}
      {children}
    </button>
  );
}
