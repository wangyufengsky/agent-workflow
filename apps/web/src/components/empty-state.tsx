import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon.tsx';

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="tile">
        <Icon name={icon} size="lg" />
      </div>
      <h3>{title}</h3>
      {body !== undefined && <p>{body}</p>}
      {action}
    </div>
  );
}
