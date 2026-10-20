import { type Acceptance, type AcceptanceCheck, AcceptanceCheckKind } from '@aw/shared';
import { Button } from '../components/button.tsx';
import { IconButton } from '../components/icon-button.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';

type CommandCheck = Extract<AcceptanceCheck, { kind: typeof AcceptanceCheckKind.Command }>;
type ReviewCheck = Extract<AcceptanceCheck, { kind: typeof AcceptanceCheckKind.AiReview }>;

/** Commands first, then the AI review: the order the checks run in (09 §3 `verifying`). */
function compose(commands: CommandCheck[], review: ReviewCheck | undefined, manual: boolean): Acceptance {
  return { checks: [...commands, ...(review === undefined ? [] : [review])], manual };
}

/**
 * A step's checks (10 §workflows `Acceptance`): commands, an AI review and manual acceptance. `undefined` means the
 * workflow's default, offered when `allowDefault` (plan steps; not the workflow default itself).
 */
export function AcceptanceEditor({
  idPrefix,
  value,
  onChange,
  disabled = false,
  allowDefault,
}: {
  idPrefix: string;
  value: Acceptance | undefined;
  onChange: (value: Acceptance | undefined) => void;
  disabled?: boolean;
  allowDefault: boolean;
}) {
  const usesDefault = allowDefault && value === undefined;
  const acceptance = value ?? { checks: [], manual: false };
  const commands = acceptance.checks.filter((c): c is CommandCheck => c.kind === AcceptanceCheckKind.Command);
  const review = acceptance.checks.find((c): c is ReviewCheck => c.kind === AcceptanceCheckKind.AiReview);
  const set = (next: { commands?: CommandCheck[]; review?: ReviewCheck | undefined; manual?: boolean }) =>
    onChange(
      compose(next.commands ?? commands, 'review' in next ? next.review : review, next.manual ?? acceptance.manual),
    );

  return (
    <fieldset className="col" disabled={disabled}>
      <legend className="label">{C.acceptance}</legend>
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
          <span className="hint">{C.commands}</span>
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
