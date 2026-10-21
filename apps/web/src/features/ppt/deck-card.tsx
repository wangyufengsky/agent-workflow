import { type DeckSummaryDTO, STATUS_TONE } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { StatusBadge } from '../../components/status-badge.tsx';
import { formatDateTime } from '../../copy/common.ts';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { deckStatusLabel } from './deck-status.ts';
import styles from './ppt.module.css';
import { SlideView } from './slide/slide-view.tsx';
import { useWidth } from './slide/use-width.ts';

/** A PPT in the list (23 §2.2): its first page, title, status, project and time. */
export function DeckCard({ deck }: { deck: DeckSummaryDTO }) {
  const thumb = useRef<HTMLDivElement>(null);
  const width = useWidth(thumb);
  return (
    <Link to={ROUTES.pptDeck} params={{ deckId: deck.id }} className={styles.deckCard} data-testid="deck-card">
      <div ref={thumb} className={styles.deckThumb}>
        {width > 0 && <SlideView content={deck.cover} placeholder={deck.title} theme={deck.theme} width={width} />}
      </div>
      <span className={`${styles.deckTitle} ellipsis`}>{deck.title}</span>
      <span className="row">
        <StatusBadge tone={STATUS_TONE.deck[deck.status]} label={deckStatusLabel(deck)} />
      </span>
      <span className="hint ellipsis">
        {[deck.project?.name, C.updated(formatDateTime(deck.updatedAt))].filter(Boolean).join(' · ')}
      </span>
    </Link>
  );
}
