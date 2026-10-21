import { type DeckDTO, DeckStatus, SLIDE_LAYOUTS, SLIDE_POINTS_MAX, SlideLayout, slideLayoutSchema } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import styles from './ppt.module.css';
import { useGenerateDeck, useReviseOutline, useUpdateOutline } from './ppt.queries.ts';

type Page = { id?: string | undefined; layout: SlideLayout; title: string; points: string[] };

const toPages = (deck: DeckDTO): Page[] =>
  deck.slides.map((s) => ({ id: s.id, layout: s.layout, title: s.title, points: s.points }));
const toLines = (points: readonly string[]) => points.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, SLIDE_POINTS_MAX);

function OutlineRow({
  page,
  index,
  count,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  page: Page;
  index: number;
  count: number;
  disabled: boolean;
  onChange(page: Page): void;
  onMove(to: number): void;
  onRemove(): void;
}) {
  const n = index + 1;
  return (
    <li className={styles.outlineRow} data-testid="outline-page">
      <span className={styles.outlineNo}>{n}</span>
      <select
        className="select"
        aria-label={`${C.page(n)} ${C.layout}`}
        value={page.layout}
        disabled={disabled}
        onChange={(e) => onChange({ ...page, layout: slideLayoutSchema.parse(e.target.value) })}
      >
        {SLIDE_LAYOUTS.map((layout) => (
          <option key={layout} value={layout}>
            {C.layouts[layout]}
          </option>
        ))}
      </select>
      <div className="grow col">
        <input
          className="input"
          aria-label={`${C.page(n)} ${C.pageTitle}`}
          defaultValue={page.title}
          disabled={disabled}
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title !== '' && title !== page.title) onChange({ ...page, title });
          }}
        />
        <textarea
          className="textarea"
          aria-label={`${C.page(n)} ${C.points}`}
          rows={Math.max(2, page.points.length)}
          defaultValue={toLines(page.points)}
          disabled={disabled}
          onBlur={(e) => {
            const points = fromLines(e.target.value);
            if (toLines(points) !== toLines(page.points)) onChange({ ...page, points });
          }}
        />
      </div>
      <div className={styles.rowActions}>
        <IconButton
          icon="arrowUp"
          label={C.moveUp(n)}
          disabled={disabled || index === 0}
          onClick={() => onMove(index - 1)}
        />
        <IconButton
          icon="arrowDown"
          label={C.moveDown(n)}
          disabled={disabled || index === count - 1}
          onClick={() => onMove(index + 1)}
        />
        <IconButton icon="trash" label={C.removePage(n)} disabled={disabled || count === 1} onClick={onRemove} />
      </div>
    </li>
  );
}

/**
 * The outline stage (23 §2.4 ①): the AI's understanding, the pages to edit, reorder, add and remove, a rewrite by
 * instruction, and「确认大纲，开始制作」. Edits are saved as they are made; the draft is the source while editing.
 */
export function OutlineEditor({ deck, model }: { deck: DeckDTO; model: string | null }) {
  const [pages, setPages] = useState(() => toPages(deck));
  const [instruction, setInstruction] = useState('');
  const save = useUpdateOutline();
  const revise = useReviseOutline();
  const generate = useGenerateDeck();
  const busy = deck.status === DeckStatus.Outlining;

  const commit = (next: Page[]) => {
    setPages(next);
    save.mutate(
      { id: deck.id, slides: next },
      {
        // New pages get their ids, so the next save keeps them instead of creating them again.
        onSuccess: (saved) =>
          setPages((current) =>
            current.length === saved.slides.length
              ? current.map((p, i) => ({ ...p, id: saved.slides[i]?.id ?? p.id }))
              : current,
          ),
      },
    );
  };
  const move = (from: number, to: number) => {
    const next = [...pages];
    const [page] = next.splice(from, 1);
    if (page === undefined) return;
    next.splice(to, 0, page);
    commit(next);
  };
  const confirm = async () => {
    // The latest edits are saved before the pages are made from them.
    await save.mutateAsync({ id: deck.id, slides: pages });
    generate.mutate({ id: deck.id, model });
  };

  if (pages.length === 0) return null;
  return (
    <div className="col">
      {deck.understanding !== null && (
        <section className="card pad col" aria-label={C.understanding}>
          <span className="label">{C.understanding}</span>
          <span>{C.audienceDuration(deck.understanding.audience, deck.understanding.duration)}</span>
          {deck.understanding.assumptions.length > 0 && (
            <ul className={styles.assumptions} aria-label={C.assumptions}>
              {deck.understanding.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ol className={styles.outline} aria-label={C.steps[0]}>
        {pages.map((page, i) => (
          <OutlineRow
            // New pages have no id until saved; a page's position is stable while the row exists.
            key={page.id ?? `new-${i}`}
            page={page}
            index={i}
            count={pages.length}
            disabled={busy}
            onChange={(changed) => commit(pages.map((p, j) => (j === i ? changed : p)))}
            onMove={(to) => move(i, to)}
            onRemove={() => commit(pages.filter((_, j) => j !== i))}
          />
        ))}
      </ol>
      <div className="row">
        <Button
          size="sm"
          icon="plus"
          disabled={busy}
          onClick={() => commit([...pages, { layout: SlideLayout.Bullets, title: C.addPage, points: [] }])}
        >
          {C.addPage}
        </Button>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className={styles.outlineFoot}>
        <input
          className="input grow"
          aria-label={C.reviseOutline}
          placeholder={C.reviseOutlinePlaceholder}
          value={instruction}
          disabled={busy}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <Button
          icon="refresh"
          disabled={busy || instruction.trim() === ''}
          pending={revise.isPending}
          onClick={() =>
            revise.mutate(
              { id: deck.id, instruction: instruction.trim(), model },
              { onSuccess: () => setInstruction('') },
            )
          }
        >
          {C.reviseOutline}
        </Button>
        <Button
          variant="primary"
          icon="play"
          disabled={busy}
          pending={generate.isPending}
          onClick={() => void confirm()}
        >
          {C.confirmOutline}
        </Button>
      </div>
      {revise.isError && <ErrorState error={revise.error} />}
      {generate.isError && <ErrorState error={generate.error} />}
    </div>
  );
}
