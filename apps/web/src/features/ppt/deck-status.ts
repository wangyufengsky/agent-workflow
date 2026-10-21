import { type DeckDTO, DeckStatus, type DeckSummaryDTO } from '@aw/shared';
import { PPT_COPY as C } from '../../copy/ppt.ts';

/** One line for a PPT's status (23 §4.3): how far the making is, how many pages are left, or the status itself. */
export function deckStatusLabel(deck: Pick<DeckSummaryDTO, 'status' | 'slideCount' | 'madeCount'>): string {
  switch (deck.status) {
    case DeckStatus.Generating:
      return deck.madeCount < deck.slideCount ? C.making(deck.madeCount, deck.slideCount) : C.revisingShort;
    case DeckStatus.Incomplete:
      return C.remaining(deck.slideCount - deck.madeCount);
    case DeckStatus.Ready:
      return C.pages(deck.slideCount);
    default:
      return C.status[deck.status];
  }
}

/** The detail's counts in the summary's shape. */
export const deckCounts = (deck: DeckDTO) => ({
  status: deck.status,
  slideCount: deck.slides.length,
  madeCount: deck.slides.filter((s) => s.content !== null).length,
});
