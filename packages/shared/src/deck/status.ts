import { DeckRunKind, DeckStatus } from '../enums/deck.ts';
import { AttemptKind, AttemptStatus } from '../enums/task.ts';

/** What kind of work an attempt of a PPT does (23 §3 `deck_runs`). */
export const deckRunKindOf = (kind: AttemptKind): DeckRunKind =>
  kind === AttemptKind.DeckOutline ? DeckRunKind.Outline : DeckRunKind.Slides;

export const isAttemptActive = (status: AttemptStatus): boolean =>
  status === AttemptStatus.Starting || status === AttemptStatus.Running;

export type DeckStatusInput = {
  outlineConfirmed: boolean;
  slideCount: number;
  /** Pages with content. */
  madeCount: number;
  /** The latest AI work; a PPT is created with its first. */
  latestRun: { kind: DeckRunKind; status: AttemptStatus } | null;
};

/**
 * A PPT's status (23 §4.3): a projection of its pages and its latest attempt, whose status only the attempt state
 * machine changes; the PPT itself has no state machine.
 */
export function deckStatusOf({ outlineConfirmed, slideCount, madeCount, latestRun }: DeckStatusInput): DeckStatus {
  if (latestRun !== null && isAttemptActive(latestRun.status)) {
    return latestRun.kind === DeckRunKind.Outline ? DeckStatus.Outlining : DeckStatus.Generating;
  }
  if (!outlineConfirmed) return slideCount > 0 ? DeckStatus.OutlineReady : DeckStatus.Failed;
  return madeCount < slideCount ? DeckStatus.Incomplete : DeckStatus.Ready;
}
