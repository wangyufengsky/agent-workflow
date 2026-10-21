import { ErrorCode, type ErrorInfo } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ApiError } from '../../api/client.ts';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import styles from './ppt.module.css';
import { deckQuery } from './ppt.queries.ts';
import { SLIDE_WIDTH } from './slide/geometry.ts';
import { SlideView } from './slide/slide-view.tsx';

const route = getRouteApi(ROUTE_IDS.pptPrint);

/** Why the PPT could not be loaded, as the exporting page shows it: the operation's error, or the backend's absence. */
function errorInfoOf(error: Error): ErrorInfo {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return { code: ErrorCode.InternalError, message: error.message };
}

/**
 * The print view (23 §6.1): every made page at 1280×720, one per printed page. In the desktop app's hidden window it
 * tells main once the pages and their fonts are ready to print, or why they cannot be shown.
 */
export function PptPrintPage() {
  const { deckId } = route.useParams();
  const deck = useQuery(deckQuery(deckId));
  const { isSuccess, error } = deck;
  useEffect(() => {
    if (isSuccess) void document.fonts.ready.then(() => window.aw?.printSettled({ ok: true }));
    else if (error !== null) window.aw?.printSettled({ ok: false, error: errorInfoOf(error) });
  }, [isSuccess, error]);

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
