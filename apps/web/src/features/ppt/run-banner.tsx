import { type DeckDTO, DeckRunKind, DeckStatus, isAttemptActive } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import styles from './ppt.module.css';
import { useGenerateDeck, useReviseOutline, useStopDeck } from './ppt.queries.ts';

/** The pages a work targets, by their numbers: 「3、5」. */
const pageNumbers = (deck: DeckDTO, ids: readonly string[]) =>
  deck.slides
    .filter((s) => ids.includes(s.id))
    .map((s) => s.seq)
    .join('、');

/**
 * What the AI is doing on the PPT, or why it stopped (23 §2.4): progress with「停止」, a permission request waiting
 * in「需要你处理」, and after a failure its reason with the way on (retry, continue).
 */
export function RunBanner({ deck }: { deck: DeckDTO }) {
  const stop = useStopDeck();
  const generate = useGenerateDeck();
  const retry = useReviseOutline();
  const run = deck.runs.at(-1);
  if (run === undefined) return null;
  const pending = deck.slides.filter((s) => s.content === null).length;

  if (isAttemptActive(run.attempt.status)) {
    const making = run.instruction === null || run.kind === DeckRunKind.Outline;
    const line =
      run.kind === DeckRunKind.Outline
        ? C.outliningHint
        : making
          ? C.making(run.done.length, run.targets.length)
          : C.revising(pageNumbers(deck, run.targets));
    return (
      <div className="banner" role="status" data-testid="deck-progress">
        <span className="spin" aria-hidden="true" />
        <div className="grow col">
          <span>{line}</span>
          {run.attempt.progress !== null && <span className="hint">{run.attempt.progress}</span>}
          {run.awaitingInput && (
            <span className={styles.waiting}>
              {C.waitingPermission}
              <Link to={ROUTES.inbox} className="link">
                {C.goHandle}
              </Link>
            </span>
          )}
        </div>
        <Button size="sm" icon="stop" pending={stop.isPending} onClick={() => stop.mutate(deck.id)}>
          {C.stop}
        </Button>
      </div>
    );
  }

  const error = run.attempt.error;
  switch (deck.status) {
    case DeckStatus.Failed:
      return (
        <div className="col">
          <div className="banner danger" role="alert">
            <span className="grow">{C.outlineFailed}</span>
            <Button size="sm" icon="refresh" pending={retry.isPending} onClick={() => retry.mutate({ id: deck.id })}>
              {C.retry}
            </Button>
          </div>
          {error !== null && <ErrorState error={error} />}
          {retry.isError && <ErrorState error={retry.error} />}
        </div>
      );
    case DeckStatus.Incomplete:
      return (
        <div className="col">
          <div className="banner" role="status">
            <span className="grow">{C.remaining(pending)}</span>
            <Button
              size="sm"
              variant="primary"
              icon="play"
              pending={generate.isPending}
              onClick={() => generate.mutate({ id: deck.id })}
            >
              {C.continueMaking(pending)}
            </Button>
          </div>
          {error !== null && <ErrorState error={error} />}
          {generate.isError && <ErrorState error={generate.error} />}
        </div>
      );
    default:
      // A revision or rewrite that did not finish leaves the PPT as it was; its reason is still worth a line.
      return error === null ? null : (
        <div className="col">
          <p className="hint">{C.reviseFailed}</p>
          <ErrorState error={error} />
        </div>
      );
  }
}
