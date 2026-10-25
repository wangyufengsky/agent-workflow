import { isDefaultInitiativeWorkflow, WorkflowKind, type WorkflowSummaryDTO } from '@aw/shared';
import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { INITIATIVES_COPY as C } from '../../copy/initiatives.ts';
import styles from './initiatives.module.css';

/** The default choice (34 §5.1), in the workflows' own order. */
export const defaultAllowedWorkflows = (workflows: readonly WorkflowSummaryDTO[]) =>
  workflows.filter(isDefaultInitiativeWorkflow).map((w) => w.key);

/**
 * 「可选流程」for an AI breakdown (34 §5.1, pro mode): which workflows its work packages may use. Folded until asked
 * for; `value` is undefined while the user keeps the default, which the server applies too.
 */
export function AllowedWorkflowsField({
  workflows,
  value,
  onChange,
}: {
  workflows: readonly WorkflowSummaryDTO[];
  value: readonly string[] | undefined;
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(value !== undefined);
  const choosable = workflows.filter((w) => w.kind !== WorkflowKind.System);
  const chosen = value ?? defaultAllowedWorkflows(choosable);
  if (!open) {
    return (
      <div className="row">
        <button type="button" className={styles.toggle} onClick={() => setOpen(true)}>
          <Icon name="flow" size="sm" />
          {C.allowedWorkflowsCount(chosen.length)}
        </button>
      </div>
    );
  }
  return (
    <fieldset className={styles.allowed}>
      <legend className="sec-t">{C.allowedWorkflows}</legend>
      <span className="hint">{C.allowedWorkflowsHint}</span>
      <div className={styles.deps}>
        {choosable.map((w) => (
          <label key={w.key} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(w.key)}
              onChange={(e) =>
                onChange(
                  // Kept in the workflows' order, whatever the order of the clicks.
                  choosable
                    .map((other) => other.key)
                    .filter((key) => (key === w.key ? e.target.checked : chosen.includes(key))),
                )
              }
            />
            <span>{w.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
