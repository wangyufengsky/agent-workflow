import type { DesignDTO, DesignTransaction } from '@aw/shared';
import { useState } from 'react';
import siteCopy from '../../copy/design-site.json';
import type { ContentContext } from './design-content.tsx';
import { DesignDiagram } from './design-diagram.tsx';
import { graphNodeTarget, type ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';

const C = siteCopy.transactions;

export function TransactionCatalog({
  entries,
  design,
  onNavigate,
  source,
}: {
  entries: (DesignTransaction & { sectionId: string })[];
  design: DesignDTO;
  onNavigate: (target: ReadingTarget) => void;
  source: ContentContext['source'];
}) {
  const [query, setQuery] = useState('');
  const [selected, select] = useState('');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const visible = entries.filter(({ title, code, channel, version, scenario }) => {
    const description = [title, code, channel, version, scenario].join(' ').toLocaleLowerCase();
    return terms.every((term) => description.includes(term));
  });
  const active = visible.find(({ diagramId }) => diagramId === selected) ?? visible[0];
  const diagram = design.diagrams.find(({ id }) => id === active?.diagramId);
  return (
    <section className={styles.transactionCatalog} aria-label={C.catalog}>
      <div className={styles.transactionGrid}>
        <div>
          <h3>{C.catalog}</h3>
          {entries.length === 0 ? (
            <p className="hint">{C.empty}</p>
          ) : (
            <>
              <input
                type="search"
                className="input"
                aria-label={C.filter}
                placeholder={C.filter}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              {visible.length === 0 ? (
                <p role="status">{C.noMatch}</p>
              ) : (
                <ul className={styles.transactionList}>
                  {visible.map((entry) => (
                    <li key={entry.diagramId}>
                      <button type="button" aria-pressed={entry === active} onClick={() => select(entry.diagramId)}>
                        <strong>{entry.title}</strong>
                        {entry.code && <code>{entry.code}</code>}
                        <small>{[entry.channel, entry.version, entry.scenario].filter(Boolean).join(' · ')}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        {active !== undefined && diagram !== undefined && (
          <div className={styles.transactionCanvas}>
            <div className="row wrap">
              <h3 className="grow">{diagram.title}</h3>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => onNavigate({ kind: 'section', sectionId: active.sectionId })}
              >
                {C.chapter}
              </button>
            </div>
            <DesignDiagram
              key={diagram.id}
              diagram={diagram}
              transaction={active}
              targetOf={(node) => graphNodeTarget(design, active.sectionId, node)}
              onNavigate={onNavigate}
              source={source}
            />
          </div>
        )}
      </div>
    </section>
  );
}
