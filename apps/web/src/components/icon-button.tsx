import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './icon.tsx';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name (06 §8). */
  label: string;
};

export function IconButton({ icon, label, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={className === undefined ? 'icon-btn' : `icon-btn ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
