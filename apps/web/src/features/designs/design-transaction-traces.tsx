import type { DesignDiagramDTO, DesignTransaction } from '@aw/shared';
import siteCopy from '../../copy/design-site.json';
import type { ContentContext } from './design-content.tsx';
import styles from './design-workbench.module.css';

export function TransactionTraces({
  transaction,
  diagram,
  source,
}: {
  transaction: DesignTransaction;
  diagram: DesignDiagramDTO;
  source: ContentContext['source'];
}) {
  const nodes = new Map(diagram.nodes.map(({ id, label }) => [id, label]));
  return (['fields', 'boundaries'] as const).map((key) =>
    transaction[key]?.length ? (
      <details key={key} className={styles.edgeList}>
        <summary>{siteCopy.transactions[key]}</summary>
        <dl>
          {transaction[key].map((trace, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: entries belong to an immutable transaction submission
            <div key={index}>
              <dt>
                <strong>{trace.name}</strong>
              </dt>
              <dd>
                {trace.steps.map((id) => nodes.get(id)).join(' → ')}
                <p>{trace.description}</p>
                {trace.evidence.map((entry, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: evidence follows submission order
                  <div key={i}>
                    {entry.evidenceClass === 'static'
                      ? source(entry.relPath, entry.lineStart, entry.lineEnd)
                      : `${siteCopy.inference} · ${entry.rationale}`}
                  </div>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    ) : null,
  );
}
