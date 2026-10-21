import { type CitationDTO, type CitationSourceDTO, CitationType } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { citationLabel } from './answer.tsx';
import styles from './knowledge.module.css';
import { citationQuery } from './knowledge.queries.ts';

type FileSource = Extract<CitationSourceDTO, { type: typeof CitationType.File }>;

/** The cited lines in their surroundings, highlighted and scrolled into view (keyed by citation, so once each). */
function FileLines({ source }: { source: FileSource }) {
  const cited = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cited.current?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <div className={styles.code} data-testid="citation-lines">
      {source.lines.map((line, i) => {
        const number = source.firstLine + i;
        const isCited = number >= source.startLine && number <= source.endLine;
        return (
          <div
            key={number}
            ref={number === source.startLine ? cited : undefined}
            className={isCited ? `${styles.codeLine} ${styles.cited}` : styles.codeLine}
            data-cited={isCited}
          >
            <span className={styles.lineNumber}>{number}</span>
            <span className={styles.lineText}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function SourceBody({ source }: { source: CitationSourceDTO }) {
  switch (source.type) {
    case CitationType.File:
      return (
        <>
          {source.changed && <p className={styles.changed}>{C.changed}</p>}
          <FileLines key={`${source.path}:${source.startLine}`} source={source} />
        </>
      );
    case CitationType.Database:
      return (
        <>
          <pre className={styles.sql}>{source.sql}</pre>
          <p className="hint">{C.runQuery}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {source.result.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {source.result.rows.map((row, i) => (
                  // Rows have no identity of their own; their order is the query's.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  <tr key={i}>
                    {row.map((value, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                      <td key={j} className="mono">
                        {value === null ? 'NULL' : String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {source.result.truncated && <p className="hint">{C.rowsTruncated}</p>}
        </>
      );
    case CitationType.Web:
      return (
        <p>
          <ExternalLink href={source.url}>{C.openInBrowser}</ExternalLink>
          <span className="hint mono"> {source.url}</span>
        </p>
      );
  }
}

/**
 * The source behind a citation, pushed in on the right so the answer stays readable (18 §2.1); previous / next walk
 * through the turn's citations, Esc closes.
 */
export function SourcePanel({
  turnId,
  citations,
  index,
  onSelect,
  onClose,
}: {
  turnId: string;
  citations: readonly CitationDTO[];
  index: number;
  onSelect(index: number): void;
  onClose(): void;
}) {
  const source = useQuery(citationQuery(turnId, index));
  const citation = citations[index - 1];
  // Esc closes from anywhere: focus may have left the panel (the last「下一处」disables itself).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <aside className={styles.panel} aria-label={C.source}>
      <div className={styles.panelHead}>
        <span className={styles.citeNumber}>{index}</span>
        <span className="col grow">
          <span className={styles.panelTitle}>{C.source}</span>
          {citation !== undefined && <span className="hint mono ellipsis">{citationLabel(citation)}</span>}
        </span>
        <IconButton icon="x" label={C.closeSource} onClick={onClose} autoFocus />
      </div>
      <div className={styles.panelBody}>
        {source.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {source.isError && <ErrorState error={source.error} onRetry={() => void source.refetch()} />}
        {source.data !== undefined && <SourceBody source={source.data} />}
      </div>
      <div className={styles.panelFoot}>
        <Button size="sm" icon="chevLeft" disabled={index <= 1} onClick={() => onSelect(index - 1)}>
          {C.previous}
        </Button>
        <span className="hint grow">
          {index} / {citations.length}
        </span>
        <Button size="sm" icon="chevRight" disabled={index >= citations.length} onClick={() => onSelect(index + 1)}>
          {C.next}
        </Button>
      </div>
    </aside>
  );
}
