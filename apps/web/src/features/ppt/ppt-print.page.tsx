import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import styles from './ppt.module.css';
import { deckQuery } from './ppt.queries.ts';
import { SLIDE_WIDTH } from './slide/geometry.ts';
import { SlideView } from './slide/slide-view.tsx';

const route = getRouteApi(ROUTE_IDS.pptPrint);

/**
 * The print view (23 §6.1): every made page at 1280×720, one per printed page. In the desktop app's hidden window it
 * tells main when the pages and their fonts are ready to print.
 */
export function PptPrintPage() {
  const { deckId } = route.useParams();
  const deck = useQuery(deckQuery(deckId));
  const ready = deck.isSuccess;
  useEffect(() => {
    if (!ready) return;
    void document.fonts.ready.then(() => window.aw?.printReady());
  }, [ready]);

  if (deck.isError) return <ErrorState error={deck.error} />;
  return (
    <div className={styles.print} data-testid="ppt-print">
      {deck.data?.slides
        .filter((s) => s.content !== null)
        .map((s) => (
          <div key={s.id} className={styles.printPage}>
            <SlideView content={s.content} theme={deck.data.theme} width={SLIDE_WIDTH} />
          </div>
        ))}
    </div>
  );
}
