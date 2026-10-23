import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';
import { ChecklistEditor, type DraftRequirement, newDraft } from './checklist-editor.tsx';
import styles from './requirements.module.css';

/** 「验收要求」when starting a task (31 §2.1): folded by default, so the simple path stays as it was. */
export function ChecklistField({
  drafts,
  onChange,
}: {
  drafts: readonly DraftRequirement[];
  onChange: (drafts: DraftRequirement[]) => void;
}) {
  const [open, setOpen] = useState(drafts.length > 0);
  if (!open) {
    return (
      <div className="row">
        <button
          type="button"
          className={styles.toggle}
          onClick={() => {
            setOpen(true);
            if (drafts.length === 0) onChange([newDraft()]);
          }}
        >
          <Icon name="check" size="sm" />
          {C.field}
        </button>
      </div>
    );
  }
  return (
    <fieldset className={styles.editor}>
      <legend className="sec-t">{C.field}</legend>
      <span className="hint">{C.fieldHint}</span>
      <ChecklistEditor drafts={drafts} onChange={onChange} />
    </fieldset>
  );
}
