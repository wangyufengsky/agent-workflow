import { AttemptStatus, DeckRunKind, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { ModelPicker } from '../knowledge/model-picker.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { AiRecord } from './ai-record.tsx';
import { DeckHeader } from './deck-header.tsx';
import { OutlineEditor } from './outline-editor.tsx';
import styles from './ppt.module.css';
import { deckQuery } from './ppt.queries.ts';
import { RunBanner } from './run-banner.tsx';
import { SlidesStage } from './slides-stage.tsx';

const route = getRouteApi(ROUTE_IDS.pptDeck);

/** One PPT's workspace (23 §2.4): the outline until it is confirmed, then the pages with their preview. */
export function PptDeckPage() {
  const { deckId } = route.useParams();
  const { slide, details } = route.useSearch();
  const settings = useSettings();
  const deck = useQuery(deckQuery(deckId));
  const latestModel = deck.data?.runs.at(-1)?.model;
  // The next AI work keeps the model of the one before unless the user picks another (like knowledge, D67 ④).
  const [chosenModel, setModel] = useState<string | null | undefined>(undefined);
  const model = chosenModel === undefined ? (latestModel ?? settings['ai.defaultModel']) : chosenModel;

  if (deck.isPending) return <p className="hint page">{COMMON_COPY.loading}</p>;
  if (deck.isError) {
    return (
      <div className="page narrow">
        <ErrorState error={deck.error} onRetry={() => void deck.refetch()} />
      </div>
    );
  }
  const d = deck.data;
  const pro = settings['ui.mode'] === UiMode.Pro || details === true;
  // A new outline from the AI replaces the draft being edited.
  const outlineVersion = d.runs
    .filter((r) => r.kind === DeckRunKind.Outline && r.attempt.status === AttemptStatus.Succeeded)
    .at(-1)?.id;

  return (
    <div className={`page ${styles.workspace}`}>
      <DeckHeader deck={d} details={details === true} />
      <RunBanner deck={d} />
      <div className="row">
        <span className="hint">{C.model}</span>
        <ModelPicker value={model} onChange={setModel} />
      </div>
      {d.outlineConfirmed ? (
        <SlidesStage deck={d} selectedId={slide} model={model} />
      ) : (
        <OutlineEditor key={outlineVersion ?? 'none'} deck={d} model={model} />
      )}
      {pro && <AiRecord deck={d} />}
    </div>
  );
}
