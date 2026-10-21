import { type DeckDTO, type DeckSlideDTO, isAttemptActive } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import styles from './ppt.module.css';
import { useRestoreSlide, useReviseSlides, useUpdateSlide } from './ppt.queries.ts';
import { SlideFields } from './slide-fields.tsx';

type Scope = 'page' | 'all';

/** 「让 AI 改」(23 §2.4 ②): this page or every made page, with one instruction. */
function AskAi({
  deck,
  slide,
  model,
  busy,
  overflow,
}: {
  deck: DeckDTO;
  slide: DeckSlideDTO;
  model: string | null;
  busy: boolean;
  overflow: boolean;
}) {
  const revise = useReviseSlides();
  const [scope, setScope] = useState<Scope>('page');
  const [instruction, setInstruction] = useState('');
  const send = (text: string, target: Scope) =>
    revise.mutate(
      {
        id: deck.id,
        slideIds: target === 'page' ? [slide.id] : deck.slides.filter((s) => s.content !== null).map((s) => s.id),
        instruction: text,
        model,
      },
      { onSuccess: () => setInstruction('') },
    );
  return (
    <section className="col" aria-label={C.askAi}>
      {overflow && (
        <div className="banner warn" role="status">
          <Icon name="alert" />
          <span className="grow">{C.overflow}</span>
          <Button size="sm" disabled={busy} onClick={() => send(C.shortenInstruction, 'page')}>
            {C.shorten}
          </Button>
        </div>
      )}
      <span className="label">{C.askAi}</span>
      <div className="row">
        <select
          className="select"
          aria-label={C.scopeLabel}
          value={scope}
          disabled={busy}
          onChange={(e) => setScope(e.target.value === 'all' ? 'all' : 'page')}
        >
          <option value="page">{C.scopePage}</option>
          <option value="all">{C.scopeAll}</option>
        </select>
      </div>
      <textarea
        className="textarea"
        rows={2}
        aria-label={C.askAi}
        placeholder={C.askAiPlaceholder}
        value={instruction}
        disabled={busy}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && instruction.trim() !== '')
            send(instruction.trim(), scope);
        }}
      />
      <div className="row">
        <span className="grow" />
        <Button
          size="sm"
          variant="primary"
          icon="sparkle"
          disabled={busy || instruction.trim() === ''}
          pending={revise.isPending}
          onClick={() => send(instruction.trim(), scope)}
        >
          {C.send}
        </Button>
      </div>
      {revise.isError && <ErrorState error={revise.error} />}
    </section>
  );
}

/** 「这一页」(23 §2.4 ②): the page's fields and notes, the AI's revision and「恢复上一版」. */
export function SlidePanel({
  deck,
  slide,
  model,
  overflow,
}: {
  deck: DeckDTO;
  slide: DeckSlideDTO;
  model: string | null;
  overflow: boolean;
}) {
  const update = useUpdateSlide();
  const restore = useRestoreSlide();
  const run = deck.runs.at(-1);
  const busy = run !== undefined && isAttemptActive(run.attempt.status);
  const making = busy && run.targets.includes(slide.id);
  const { content } = slide;

  return (
    <aside className={styles.panel} aria-label={C.page(slide.seq)}>
      <div className="row">
        <span className="label grow">{C.page(slide.seq)}</span>
        <span className="hint">{C.layouts[content?.layout ?? slide.layout]}</span>
      </div>
      {busy && <p className="hint">{C.busyHint}</p>}
      {content === null ? (
        <p className="hint">{making ? C.pageMaking : C.pageNotMade}</p>
      ) : (
        <>
          <SlideFields
            // A new version from the server (the AI's, a restore) starts a new draft.
            key={`${slide.id}-${slide.updatedAt}`}
            content={content}
            disabled={busy}
            onSave={(next) => update.mutate({ id: deck.id, slideId: slide.id, content: next, notes: slide.notes })}
          />
          <label className="field">
            <span className="label">{C.notes}</span>
            <textarea
              key={`${slide.id}-${slide.updatedAt}`}
              className="textarea"
              rows={3}
              placeholder={C.notesPlaceholder}
              defaultValue={slide.notes}
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value !== slide.notes) {
                  update.mutate({ id: deck.id, slideId: slide.id, content, notes: e.target.value });
                }
              }}
            />
          </label>
          {update.isError && <ErrorState error={update.error} />}
          <AskAi deck={deck} slide={slide} model={model} busy={busy} overflow={overflow} />
          {slide.hasPrevious && (
            <Button
              size="sm"
              variant="ghost"
              icon="undo"
              title={C.restoreHint}
              disabled={busy}
              pending={restore.isPending}
              onClick={() => restore.mutate({ id: deck.id, slideId: slide.id })}
            >
              {C.restore}
            </Button>
          )}
          {restore.isError && <ErrorState error={restore.error} />}
        </>
      )}
    </aside>
  );
}
