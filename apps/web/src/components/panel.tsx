import type { ReactNode } from 'react';

type PanelProps = { title?: ReactNode; actions?: ReactNode; footer?: ReactNode; children: ReactNode; solid?: boolean };

export function Panel({ title, actions, footer, children, solid = false }: PanelProps) {
  return (
    <section className={solid ? 'card solid' : 'card'}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card-head">
          {title !== undefined && <h2 className="section-title grow">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer !== undefined && <footer className="card-foot">{footer}</footer>}
    </section>
  );
}
