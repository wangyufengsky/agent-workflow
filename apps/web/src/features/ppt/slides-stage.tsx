import {
  type DeckDTO,
  type DeckSlideDTO,
  isAttemptActive,
  SLIDE_LAYOUTS,
  SlideLayout,
  slideLayoutSchema,
} from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import styles from './ppt.module.css';
import { useDeleteSlide, useInsertSlide, useMoveSlide } from './ppt.queries.ts';
import { SlideView } from './slide/slide-view.tsx';
import { useWidth } from './slide/use-width.ts';
import { SlidePanel } from './slide-panel.tsx';

function Thumb({
  deck,
  slide,
  selected,
  making,
  overflow,
  onSelect,
  onOverflow,
}: {
  deck: DeckDTO;
  slide: DeckSlideDTO;
  selected: boolean;
  making: boolean;
  overflow: boolean;
  onSelect(): void;
  onOverflow(id: string, overflow: boolean): void;
}) {
  const report = useCallback((value: boolean) => onOverflow(slide.id, value), [onOverflow, slide.id]);
  // The page fills what the button has left beside its number, inside its padding and border.
  const frame = useRef<HTMLSpanElement>(null);
  const width = useWidth(frame);
  return (
    <button
      type="button"
      className={selected ? `${styles.thumb} ${styles.thumbOn}` : styles.thumb}
      aria-current={selected}
      aria-label={`${C.page(slide.seq)} ${slide.title}`}
      onClick={onSelect}
      data-testid="slide-thumb"
    >
      <span className={styles.thumbNo}>{slide.seq}</span>
      <span ref={frame} className={styles.thumbSlide}>
        {width > 0 && (
          <SlideView
            content={slide.content}
            placeholder={slide.title}
            theme={deck.theme}
            width={width}
            onOverflow={report}
          />
        )}
      </span>
      {making && <span className={styles.thumbState}>{C.pageMaking}</span>}
      {overflow && (
        <span className={styles.thumbWarn} title={C.overflow}>
          <Icon name="alert" size="sm" />
        </span>
      )}
    </button>
  );
}

/** 「加一页」after the selected page: its layout, title and points; the AI makes only it. */
function InsertDialog({
  deck,
  after,
  model,
  open,
  onOpenChange,
  onInserted,
}: {
  deck: DeckDTO;
  after: DeckSlideDTO | undefined;
  model: string | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onInserted(deck: DeckDTO): void;
}) {
  const insert = useInsertSlide();
  const [layout, setLayout] = useState<SlideLayout>(SlideLayout.Bullets);
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={C.insertTitle}
      {...(after === undefined ? {} : { description: `${C.insertAfter}：${C.page(after.seq)}` })}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{C.cancel}</Button>
          <Button
            variant="primary"
            disabled={title.trim() === ''}
            pending={insert.isPending}
            onClick={() =>
              insert.mutate(
                {
                  id: deck.id,
                  ...(after === undefined ? {} : { afterSlideId: after.id }),
                  layout,
                  title: title.trim(),
                  points: points
                    .split('\n')
                    .map((p) => p.trim())
                    .filter((p) => p !== ''),
                  model,
                },
                {
                  onSuccess: (saved) => {
                    onOpenChange(false);
                    onInserted(saved);
                  },
                },
              )
            }
          >
            {C.add}
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="label">{C.layout}</span>
        <select className="select" value={layout} onChange={(e) => setLayout(slideLayoutSchema.parse(e.target.value))}>
          {SLIDE_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {C.layouts[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">{C.pageTitle}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">{C.points}</span>
        <textarea className="textarea" rows={3} value={points} onChange={(e) => setPoints(e.target.value)} />
      </label>
      {insert.isError && <ErrorState error={insert.error} />}
    </Dialog>
  );
}

/**
 * The making and preview stage (23 §2.4 ②): thumbnails on the left, the selected page large in the middle, its panel
 * on the right. `selectedId` lives in the address (`?slide=`).
 */
export function SlidesStage({
  deck,
  selectedId,
  model,
}: {
  deck: DeckDTO;
  selectedId: string | undefined;
  model: string | null;
}) {
  const navigate = useNavigate();
  const preview = useRef<HTMLElement>(null);
  const width = useWidth(preview);
  const move = useMoveSlide();
  const remove = useDeleteSlide();
  const [inserting, setInserting] = useState(false);
  const [overflows, setOverflows] = useState<ReadonlySet<string>>(new Set());
  const onOverflow = useCallback(
    (id: string, overflow: boolean) =>
      setOverflows((current) => {
        if (current.has(id) === overflow) return current;
        const next = new Set(current);
        if (overflow) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const run = deck.runs.at(-1);
  const busy = run !== undefined && isAttemptActive(run.attempt.status);
  const index = Math.max(
    0,
    deck.slides.findIndex((s) => s.id === selectedId),
  );
  const slide = deck.slides[index];
  const slideId = slide?.id;
  const reportPreview = useCallback(
    (value: boolean) => {
      if (slideId !== undefined) onOverflow(slideId, value);
    },
    [onOverflow, slideId],
  );
  const select = (id: string | undefined) =>
    void navigate({
      to: ROUTES.pptDeck,
      params: { deckId: deck.id },
      search: (prev) => ({ ...prev, slide: id }),
      replace: true,
    });
  if (slide === undefined) return null;

  return (
    <div className={styles.stage}>
      <nav className={styles.rail} aria-label={C.pages(deck.slides.length)}>
        {deck.slides.map((s) => (
          <Thumb
            key={s.id}
            deck={deck}
            slide={s}
            selected={s.id === slide.id}
            making={busy && run.targets.includes(s.id) && !run.done.includes(s.id)}
            overflow={overflows.has(s.id)}
            onSelect={() => select(s.id)}
            onOverflow={onOverflow}
          />
        ))}
        <div className={styles.railActions}>
          <IconButton
            icon="arrowUp"
            label={C.moveUp(slide.seq)}
            disabled={busy || index === 0}
            onClick={() => move.mutate({ id: deck.id, slideId: slide.id, toSeq: slide.seq - 1 })}
          />
          <IconButton
            icon="arrowDown"
            label={C.moveDown(slide.seq)}
            disabled={busy || index === deck.slides.length - 1}
            onClick={() => move.mutate({ id: deck.id, slideId: slide.id, toSeq: slide.seq + 1 })}
          />
          <IconButton
            icon="trash"
            label={C.removePage(slide.seq)}
            disabled={busy || deck.slides.length === 1}
            onClick={() => remove.mutate({ id: deck.id, slideId: slide.id }, { onSuccess: () => select(undefined) })}
          />
          <IconButton icon="plus" label={C.addPage} disabled={busy} onClick={() => setInserting(true)} />
        </div>
        {(move.isError || remove.isError) && <ErrorState error={move.error ?? remove.error} />}
      </nav>
      <section
        ref={preview}
        className={styles.preview}
        // Arrow keys page through the PPT like the show does.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the preview takes the arrow keys
        tabIndex={0}
        aria-label={`${C.page(slide.seq)} ${slide.title}`}
        onKeyDown={(e) => {
          const to = e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : undefined;
          const next = to === undefined ? undefined : deck.slides[to];
          if (next !== undefined) select(next.id);
        }}
        data-testid="slide-preview"
      >
        {width > 0 && (
          <SlideView
            content={slide.content}
            placeholder={slide.title}
            theme={deck.theme}
            width={width}
            onOverflow={reportPreview}
          />
        )}
      </section>
      <SlidePanel
        // Another page starts with its own drafts.
        key={slide.id}
        deck={deck}
        slide={slide}
        model={model}
        overflow={overflows.has(slide.id)}
      />
      <InsertDialog
        key={String(inserting)}
        deck={deck}
        after={slide}
        model={model}
        open={inserting}
        onOpenChange={setInserting}
        onInserted={(saved) => select(saved.slides[index + 1]?.id)}
      />
    </div>
  );
}
