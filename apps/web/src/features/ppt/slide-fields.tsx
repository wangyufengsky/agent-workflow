import { type SlideContent, type SlideContentOf, SlideLayout, slideContentSchema } from '@aw/shared';
import { useId, useState } from 'react';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import styles from './ppt.module.css';

const F = C.field;
const CELL_SEPARATOR = '|';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
const cells = (line: string) => line.split(CELL_SEPARATOR).map((c) => c.trim());
/** An optional field left empty is left out. */
const optional = (text: string) => (text.trim() === '' ? undefined : text.trim());

/**
 * A field shows the text as typed and hands it on at each keystroke. Fields parse it into the draft (lines, cells, an
 * optional value), and showing the parsed draft instead would drop a new line or a space as soon as it is typed. The
 * form is remade for each version from the server, so `initial` is all it needs from outside.
 */
function Text({
  label,
  initial,
  rows,
  onChange,
}: {
  label: string;
  initial: string;
  rows?: number;
  onChange(text: string): void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const change = (next: string) => {
    setText(next);
    onChange(next);
  };
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {rows === undefined ? (
        <input id={id} className="input" value={text} onChange={(e) => change(e.target.value)} />
      ) : (
        <textarea id={id} className="textarea" rows={rows} value={text} onChange={(e) => change(e.target.value)} />
      )}
    </div>
  );
}

/** A page's text fields in its layout (23 §2.4 ②): edited as a draft, saved when focus leaves the form. */
export function SlideFields({
  content,
  disabled,
  onSave,
}: {
  content: SlideContent;
  disabled: boolean;
  onSave(content: SlideContent): void;
}) {
  const [draft, setDraft] = useState(content);
  const [invalid, setInvalid] = useState(false);

  const setColumn = (
    d: SlideContentOf<'two_column'>,
    side: 'left' | 'right',
    column: SlideContentOf<'two_column'>['left'],
  ) => setDraft(side === 'left' ? { ...d, left: column } : { ...d, right: column });

  const commit = () => {
    const parsed = slideContentSchema.safeParse(draft);
    setInvalid(!parsed.success);
    if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(content)) onSave(parsed.data);
  };

  const titleField = draft.layout !== SlideLayout.Quote && (
    <Text label={F.title} initial={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
  );

  return (
    <fieldset
      className={styles.fields}
      disabled={disabled}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) commit();
      }}
      aria-label={C.content}
    >
      {titleField}
      {(draft.layout === SlideLayout.Cover || draft.layout === SlideLayout.Section) && (
        <Text
          label={F.subtitle}
          initial={draft.subtitle ?? ''}
          onChange={(v) => setDraft({ ...draft, subtitle: optional(v) })}
        />
      )}
      {draft.layout === SlideLayout.Bullets && (
        <Text
          label={F.bullets}
          rows={6}
          initial={draft.bullets.join('\n')}
          onChange={(v) => setDraft({ ...draft, bullets: lines(v) })}
        />
      )}
      {draft.layout === SlideLayout.TwoColumn &&
        (['left', 'right'] as const).map((side) => (
          <div key={side} className="col">
            <span className="sub-label">{side === 'left' ? F.left : F.right}</span>
            <Text
              label={F.heading}
              initial={draft[side].heading}
              onChange={(heading) => setColumn(draft, side, { ...draft[side], heading })}
            />
            <Text
              label={F.bullets}
              rows={4}
              initial={draft[side].bullets.join('\n')}
              onChange={(v) => setColumn(draft, side, { ...draft[side], bullets: lines(v) })}
            />
          </div>
        ))}
      {draft.layout === SlideLayout.Cards &&
        draft.cards.map((card, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: cards are positional
          <div key={i} className="col">
            <Text
              label={`${F.heading} ${i + 1}`}
              initial={card.heading}
              onChange={(heading) =>
                setDraft({ ...draft, cards: draft.cards.map((c, j) => (j === i ? { ...c, heading } : c)) })
              }
            />
            <Text
              label={`${F.body} ${i + 1}`}
              rows={2}
              initial={card.body}
              onChange={(body) =>
                setDraft({ ...draft, cards: draft.cards.map((c, j) => (j === i ? { ...c, body } : c)) })
              }
            />
          </div>
        ))}
      {draft.layout === SlideLayout.Steps &&
        draft.steps.map((step, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
          <div key={i} className="col">
            <Text
              label={`${F.label} ${i + 1}`}
              initial={step.label}
              onChange={(label) =>
                setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, label } : s)) })
              }
            />
            <Text
              label={`${F.detail} ${i + 1}`}
              initial={step.detail ?? ''}
              onChange={(v) =>
                setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, detail: optional(v) } : s)) })
              }
            />
          </div>
        ))}
      {draft.layout === SlideLayout.Stats &&
        draft.stats.map((stat, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: figures are positional
          <div key={i} className="grid-2">
            <Text
              label={`${F.value} ${i + 1}`}
              initial={stat.value}
              onChange={(value) =>
                setDraft({ ...draft, stats: draft.stats.map((s, j) => (j === i ? { ...s, value } : s)) })
              }
            />
            <Text
              label={`${F.statLabel} ${i + 1}`}
              initial={stat.label}
              onChange={(label) =>
                setDraft({ ...draft, stats: draft.stats.map((s, j) => (j === i ? { ...s, label } : s)) })
              }
            />
          </div>
        ))}
      {draft.layout === SlideLayout.Table && (
        <>
          <Text
            label={F.columns}
            initial={draft.columns.join(` ${CELL_SEPARATOR} `)}
            onChange={(v) => setDraft({ ...draft, columns: cells(v) })}
          />
          <Text
            label={F.rows}
            rows={6}
            initial={draft.rows.map((row) => row.join(` ${CELL_SEPARATOR} `)).join('\n')}
            onChange={(v) => setDraft({ ...draft, rows: lines(v).map(cells) })}
          />
        </>
      )}
      {draft.layout === SlideLayout.Code && (
        <>
          <Text label={F.language} initial={draft.language} onChange={(language) => setDraft({ ...draft, language })} />
          <label className="field">
            <span className="label">{F.code}</span>
            <textarea
              className={`textarea mono ${styles.codeInput}`}
              rows={8}
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <Text
            label={F.caption}
            initial={draft.caption ?? ''}
            onChange={(v) => setDraft({ ...draft, caption: optional(v) })}
          />
        </>
      )}
      {draft.layout === SlideLayout.Quote && (
        <>
          <Text label={F.quote} rows={3} initial={draft.quote} onChange={(quote) => setDraft({ ...draft, quote })} />
          <Text
            label={F.attribution}
            initial={draft.attribution ?? ''}
            onChange={(v) => setDraft({ ...draft, attribution: optional(v) })}
          />
        </>
      )}
      {invalid && <p className="error-text">{C.invalid}</p>}
    </fieldset>
  );
}
