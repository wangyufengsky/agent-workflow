import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { THEMES } from '../../theme/registry.ts';
import styles from './ppt.module.css';
import { deckQuery } from './ppt.queries.ts';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './slide/geometry.ts';
import { SlideView } from './slide/slide-view.tsx';
import { useWidth } from './slide/use-width.ts';

const route = getRouteApi(ROUTE_IDS.pptPlay);
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp'];

/** 「放映」(23 §2.4): the made pages full screen; arrows, space and clicks page through, Esc leaves. */
export function PptPlayPage() {
  const { deckId } = route.useParams();
  const { slide } = route.useSearch();
  const navigate = useNavigate();
  const deck = useQuery(deckQuery(deckId));
  const stage = useRef<HTMLDivElement>(null);
  const width = useWidth(stage);
  const [height, setHeight] = useState(window.innerHeight);
  const pages = deck.data?.slides.filter((s) => s.content !== null) ?? [];
  const index = Math.max(
    0,
    pages.findIndex((s) => s.id === slide),
  );
  const current = pages[index];

  useEffect(() => {
    const goTo = (to: number) => {
      const target = pages[to];
      if (target !== undefined)
        void navigate({ to: ROUTES.pptPlay, params: { deckId }, search: { slide: target.id }, replace: true });
    };
    const leave = () => void navigate({ to: ROUTES.pptDeck, params: { deckId }, search: { slide: current?.id } });
    const onKey = (e: KeyboardEvent) => {
      if (NEXT_KEYS.includes(e.key)) goTo(index + 1);
      else if (PREVIOUS_KEYS.includes(e.key)) goTo(index - 1);
      else if (e.key === 'Escape') leave();
    };
    // Esc in full screen only leaves full screen; the show ends with it.
    const onFullscreen = () => {
      if (document.fullscreenElement === null) leave();
    };
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('resize', onResize);
    };
  }, [deckId, index, pages, current, navigate]);

  if (deck.isPending) return <p className="hint page">{COMMON_COPY.loading}</p>;
  if (deck.isError) return <ErrorState error={deck.error} onRetry={() => void deck.refetch()} />;
  // The largest 16:9 page that fits the screen.
  const shown = Math.min(width, (height * SLIDE_WIDTH) / SLIDE_HEIGHT);
  return (
    // Keys are handled on window (above); a click anywhere is「下一页」as a convenience for the mouse.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      ref={stage}
      className={styles.play}
      style={{ background: THEMES[deck.data.theme].slides.bg }}
      onClick={() => {
        const next = pages[index + 1];
        if (next !== undefined)
          void navigate({ to: ROUTES.pptPlay, params: { deckId }, search: { slide: next.id }, replace: true });
      }}
      data-testid="ppt-play"
    >
      {current !== undefined && shown > 0 && (
        <SlideView content={current.content} theme={deck.data.theme} width={shown} />
      )}
      <span className={styles.playHint}>
        {index + 1} / {pages.length} · {C.playHint}
      </span>
    </div>
  );
}
