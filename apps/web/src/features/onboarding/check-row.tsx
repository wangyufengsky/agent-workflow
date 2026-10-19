import { StatusTone } from '@aw/shared';
import type { ReactNode } from 'react';
import { Icon } from '../../components/icon.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';

type CheckRowProps = { title: string; tone: StatusTone; badge: string; children: ReactNode };

/** One onboarding check: status, a one-line reason and, when not ready, how to fix it (14 §3.1). */
export function CheckRow({ title, tone, badge, children }: CheckRowProps) {
  return (
    <div className="list-row" data-testid={`check-${title}`}>
      <span className={`tile tone-${tone}`}>
        <Icon name={tone === StatusTone.Ok ? 'check' : tone === StatusTone.Danger ? 'alert' : 'info'} />
      </span>
      <div className="grow col">
        <div className="row">
          <span className="section-title">{title}</span>
          <StatusBadge tone={tone} label={badge} />
        </div>
        {children}
      </div>
    </div>
  );
}
