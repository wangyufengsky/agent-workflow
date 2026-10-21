import { type CitationDTO, CitationType, citationMarkers } from '@aw/shared';
import { useMemo } from 'react';
import type { Components } from 'react-markdown';
import { ExternalLink } from '../../components/external-link.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import styles from './knowledge.module.css';

const CITE_HREF = '#cite-';
/** A marker of a draft: not checked yet, so never a link (18 §5.5). */
const PENDING_HREF = '#pending-';

/** Each marker `[n]` (of a known citation, when `count` is given) becomes a link the renderer turns into a mark. */
function linkMarkers(answer: string, href: string, count = Number.POSITIVE_INFINITY): string {
  let text = answer;
  for (const { n, start, end } of citationMarkers(answer).reverse()) {
    if (n >= 1 && n <= count) text = `${text.slice(0, start)}[${n}](${href}${n})${text.slice(end)}`;
  }
  return text;
}

const draftComponents: Components = {
  a: ({ href, children }) =>
    href?.startsWith(PENDING_HREF) === true ? (
      <span className={styles.pendingMark} title={C.pendingCitation}>
        {href.slice(PENDING_HREF.length)}
      </span>
    ) : (
      children
    ),
};

/**
 * The answer as the researcher writes it (18 §5.5): its markers are grey and not clickable until the submitted
 * answer passed the citation check.
 */
export function DraftAnswer({ draft, stopped }: { draft: string; stopped: boolean }) {
  const source = useMemo(() => linkMarkers(draft, PENDING_HREF), [draft]);
  return (
    <div className={styles.answer} data-testid="answer-draft">
      <Markdown source={source} components={draftComponents} />
      <p className="hint">{stopped ? C.draftStopped : C.draftWriting}</p>
    </div>
  );
}

export function citationLabel(citation: CitationDTO): string {
  switch (citation.type) {
    case CitationType.File:
      return `${citation.path} · ${C.lines(citation.startLine, citation.endLine)}`;
    case CitationType.Database:
      return `${citation.connection} · ${citation.sql}`;
    case CitationType.Web:
      return citation.title ?? citation.url;
  }
}

/** The answer with clickable citation marks, then its citations (18 §2.1). */
export function Answer({
  answer,
  citations,
  active,
  onCite,
}: {
  answer: string;
  citations: readonly CitationDTO[];
  /** The citation whose source is open, if it is one of this answer's. */
  active: number | undefined;
  onCite(index: number, trigger: HTMLElement): void;
}) {
  const source = useMemo(() => linkMarkers(answer, CITE_HREF, citations.length), [answer, citations.length]);
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith(CITE_HREF) === true) {
        const n = Number(href.slice(CITE_HREF.length));
        return (
          <button
            type="button"
            className={styles.citeMark}
            aria-label={C.citationMark(n)}
            aria-pressed={active === n}
            onClick={(e) => onCite(n, e.currentTarget)}
          >
            {n}
          </button>
        );
      }
      return href === undefined ? children : <ExternalLink href={href}>{children}</ExternalLink>;
    },
  };
  return (
    <div className={styles.answer}>
      <Markdown source={source} components={components} />
      {citations.length === 0 ? (
        <p className="hint">{C.noCitations}</p>
      ) : (
        <ol className={styles.citeList} aria-label={C.citations}>
          {citations.map((citation, i) => (
            // A citation's number is its position (18 §6.1); the list never reorders.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i}>
              <button
                type="button"
                className={styles.citeCard}
                aria-pressed={active === i + 1}
                onClick={(e) => onCite(i + 1, e.currentTarget)}
              >
                <span className={styles.citeNumber}>{i + 1}</span>
                <span className="mono ellipsis">{citationLabel(citation)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
