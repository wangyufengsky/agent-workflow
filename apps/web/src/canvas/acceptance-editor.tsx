import { type Acceptance, type AcceptanceCheck, AcceptanceCheckKind } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../components/button.tsx';
import { IconButton } from '../components/icon-button.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';

type CommandCheck = Extract<AcceptanceCheck, { kind: typeof AcceptanceCheckKind.Command }>;
type PageCheck = Extract<AcceptanceCheck, { kind: typeof AcceptanceCheckKind.Browser }>;
type ReviewCheck = Extract<AcceptanceCheck, { kind: typeof AcceptanceCheckKind.AiReview }>;
type Parts = {
  commands: CommandCheck[];
  page: PageCheck | undefined;
  review: ReviewCheck | undefined;
  manual: boolean;
};

/** Commands, the page check, then the AI review: the order the checks run in (09 §3 `verifying`). */
function compose({ commands, page, review, manual }: Parts): Acceptance {
  return {
    checks: [...commands, ...(page === undefined ? [] : [page]), ...(review === undefined ? [] : [review])],
    manual,
  };
}

/** The page check's paths as typed (separated by spaces or commas); none means the project's key pages. */
const pathsOf = (text: string) => text.split(/[\s,，]+/).filter((p) => p !== '');

function PagesInput({ check, onChange }: { check: PageCheck; onChange: (check: PageCheck) => void }) {
  // The text is kept as typed: parsing it back on every keystroke would swallow the separator being typed. Paths that
  // changed from elsewhere (undo, redo) replace it.
  const paths = (check.pages ?? []).join(' ');
  const [text, setText] = useState(paths);
  if (pathsOf(text).join(' ') !== paths) setText(paths);
  return (
    <input
      className="input mono"
      aria-label={C.pageCheckPages}
      placeholder={C.pageCheckPages}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const pages = pathsOf(e.target.value);
        const { pages: _, ...rest } = check;
        onChange(pages.length === 0 ? rest : { ...rest, pages });
      }}
    />
  );
}

/**
 * A step's checks (10 §workflows `Acceptance`): commands, a page check, an AI review and manual acceptance. `undefined` means the
 * workflow's default, offered when `allowDefault` (plan steps; not the workflow default itself). Without `legend` the
 * surrounding panel's title names the group.
 */
export function AcceptanceEditor({
  idPrefix,
  legend,
  value,
  onChange,
  disabled = false,
  allowDefault,
}: {
  idPrefix: string;
  legend?: string;
  value: Acceptance | undefined;
  onChange: (value: Acceptance | undefined) => void;
  disabled?: boolean;
  allowDefault: boolean;
}) {
  const usesDefault = allowDefault && value === undefined;
  const acceptance = value ?? { checks: [], manual: false };
  const commands = acceptance.checks.filter((c): c is CommandCheck => c.kind === AcceptanceCheckKind.Command);
  const page = acceptance.checks.find((c): c is PageCheck => c.kind === AcceptanceCheckKind.Browser);
  const review = acceptance.checks.find((c): c is ReviewCheck => c.kind === AcceptanceCheckKind.AiReview);
  const set = (next: Partial<Parts>) =>
    onChange(compose({ commands, page, review, manual: acceptance.manual, ...next }));

  return (
    <fieldset className="field" disabled={disabled} aria-label={legend === undefined ? C.acceptance : undefined}>
      {legend !== undefined && <legend className="label">{legend}</legend>}
      {allowDefault && (
        <label className="check">
          <input
            type="checkbox"
            checked={usesDefault}
            onChange={(e) => onChange(e.target.checked ? undefined : { checks: [], manual: false })}
          />
          <span>{C.useDefaultAcceptance}</span>
        </label>
      )}
      {!usesDefault && (
        <>
          <span className="sub-label">{C.commands}</span>
          {commands.map((check, index) => (
            // Commands have no identity besides their position while being typed.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <div key={index} className="row">
              <input
                className="input grow mono"
                aria-label={`${C.commands} ${index + 1}`}
                placeholder={C.commandPlaceholder}
                value={check.command}
                onChange={(e) =>
                  set({
                    commands: commands.map((c, i) => (i === index ? { ...c, command: e.target.value } : c)),
                  })
                }
              />
              <IconButton
                icon="x"
                label={C.removeCommand}
                onClick={() => set({ commands: commands.filter((_, i) => i !== index) })}
              />
            </div>
          ))}
          <div className="row">
            <Button
              size="sm"
              icon="plus"
              onClick={() => set({ commands: [...commands, { kind: AcceptanceCheckKind.Command, command: '' }] })}
            >
              {C.addCommand}
            </Button>
            <span className="hint">{C.commandHint}</span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={page !== undefined}
              onChange={(e) => set({ page: e.target.checked ? { kind: AcceptanceCheckKind.Browser } : undefined })}
            />
            <span>{C.pageCheck}</span>
          </label>
          {page !== undefined && (
            <>
              <PagesInput check={page} onChange={(next) => set({ page: next })} />
              <span className="hint">{C.pageCheckHint}</span>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={review !== undefined}
              onChange={(e) => set({ review: e.target.checked ? { kind: AcceptanceCheckKind.AiReview } : undefined })}
            />
            <span>{C.aiReview}</span>
          </label>
          {review !== undefined && (
            <input
              id={`${idPrefix}-focus`}
              className="input"
              aria-label={C.reviewFocus}
              placeholder={C.reviewFocus}
              value={review.focus ?? ''}
              onChange={(e) =>
                set({
                  review:
                    e.target.value === ''
                      ? { kind: AcceptanceCheckKind.AiReview }
                      : { kind: AcceptanceCheckKind.AiReview, focus: e.target.value },
                })
              }
            />
          )}
          <label className="check">
            <input type="checkbox" checked={acceptance.manual} onChange={(e) => set({ manual: e.target.checked })} />
            <span>{C.manual}</span>
          </label>
        </>
      )}
    </fieldset>
  );
}
