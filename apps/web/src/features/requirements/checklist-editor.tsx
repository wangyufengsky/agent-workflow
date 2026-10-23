import {
  type CreateTaskRequest,
  type RequirementItem,
  RequirementVerification,
  requirementVerificationKindSchema,
} from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';
import styles from './requirements.module.css';

/** One item while it is written: `id` keeps an item of the saved checklist (31 §2.1). */
export type DraftRequirement = {
  key: string;
  id?: string;
  title: string;
  expected: string;
  required: boolean;
  kind: RequirementVerification;
  command: string;
};

export const newDraft = (): DraftRequirement => ({
  key: crypto.randomUUID(),
  title: '',
  expected: '',
  required: true,
  kind: RequirementVerification.AiReview,
  command: '',
});

export const draftsOf = (items: readonly RequirementItem[]): DraftRequirement[] =>
  items.map((item) => ({
    key: item.id,
    id: item.id,
    title: item.title,
    expected: item.expected,
    required: item.required,
    kind: item.verification.kind,
    command: item.verification.kind === RequirementVerification.Command ? item.verification.command : '',
  }));

/** Every item has its texts, and a command item its command. */
export const isComplete = (drafts: readonly DraftRequirement[]): boolean =>
  drafts.every(
    (d) =>
      d.title.trim() !== '' &&
      d.expected.trim() !== '' &&
      (d.kind !== RequirementVerification.Command || d.command.trim() !== ''),
  );

/** Complete items (every field given), as both `tasks.create` and `requirements.replace` take them. */
export const toInputs = (drafts: readonly DraftRequirement[]): NonNullable<CreateTaskRequest['requirements']> =>
  drafts.map((d) => ({
    ...(d.id === undefined ? {} : { id: d.id }),
    title: d.title.trim(),
    expected: d.expected.trim(),
    required: d.required,
    verification:
      d.kind === RequirementVerification.Command
        ? { kind: RequirementVerification.Command, command: d.command.trim() }
        : { kind: d.kind },
  }));

/** The items of a checklist, edited in place; adding, removing and changing an item are all here. */
export function ChecklistEditor({
  drafts,
  onChange,
}: {
  drafts: readonly DraftRequirement[];
  onChange: (drafts: DraftRequirement[]) => void;
}) {
  const update = (key: string, patch: Partial<DraftRequirement>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  return (
    <div className={styles.editor}>
      <ol className={styles.editList}>
        {drafts.map((d, i) => (
          <li key={d.key} className={styles.editItem}>
            <div className={styles.editRow}>
              <span className={styles.index}>R{i + 1}</span>
              <input
                className="input grow"
                aria-label={`${C.title} ${i + 1}`}
                placeholder={C.titlePlaceholder}
                value={d.title}
                onChange={(e) => update(d.key, { title: e.target.value })}
              />
              <IconButton
                icon="x"
                label={C.remove(i + 1)}
                onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
              />
            </div>
            <textarea
              className="textarea"
              rows={2}
              aria-label={`${C.expected} ${i + 1}`}
              placeholder={C.expectedPlaceholder}
              value={d.expected}
              onChange={(e) => update(d.key, { expected: e.target.value })}
            />
            <div className={styles.editRow}>
              <select
                className={`select ${styles.kind}`}
                aria-label={`${C.verification} ${i + 1}`}
                value={d.kind}
                onChange={(e) => update(d.key, { kind: requirementVerificationKindSchema.parse(e.target.value) })}
              >
                {Object.values(RequirementVerification).map((kind) => (
                  <option key={kind} value={kind}>
                    {C.verificationLabel[kind]}
                  </option>
                ))}
              </select>
              {d.kind === RequirementVerification.Command && (
                <input
                  className="input mono grow"
                  aria-label={`${C.command} ${i + 1}`}
                  placeholder={C.commandPlaceholder}
                  value={d.command}
                  onChange={(e) => update(d.key, { command: e.target.value })}
                />
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.required}
                  onChange={(e) => update(d.key, { required: e.target.checked })}
                />
                <span>{C.required}</span>
              </label>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <Button size="sm" icon="plus" onClick={() => onChange([...drafts, newDraft()])}>
          {C.add}
        </Button>
        {!isComplete(drafts) && <span className="hint">{C.incomplete}</span>}
      </div>
    </div>
  );
}
