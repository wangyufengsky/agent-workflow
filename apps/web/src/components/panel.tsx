import { type ReactNode, useId } from 'react';

type PanelProps = { title?: ReactNode; actions?: ReactNode; footer?: ReactNode; children: ReactNode; solid?: boolean };

export function Panel({ title, actions, footer, children, solid = false }: PanelProps) {
  const titleId = useId();
  return (
    // Named by its title, a panel is a region readers and tests find by name.
    <section className={solid ? 'card solid' : 'card'} aria-labelledby={title === undefined ? undefined : titleId}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card-head">
          {title !== undefined && (
            <h2 id={titleId} className="section-title grow">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer !== undefined && <footer className="card-foot">{footer}</footer>}
    </section>
  );
}
