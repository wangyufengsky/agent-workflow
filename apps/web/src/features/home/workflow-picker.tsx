import { type InitiativeTemplateDTO, WorkflowKind, type WorkflowSummaryDTO } from '@aw/shared';
import { type CSSProperties, type RefObject, useEffect, useRef } from 'react';
import { Icon } from '../../components/icon.tsx';
import { HOME_COPY as C } from '../../copy/home.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { templateChain } from '../initiatives/use-start-initiative.ts';
import styles from './home.module.css';
import { workflowIcon } from './workflow-icon.ts';

/**
 * The workflows under「直接开始」(36 §5, D145): inside the box, above its foot, folded until asked for. Opening moves
 * focus to the picked workflow or the first one — the panel comes before the foot, so Tab would skip it — and Esc
 * folds it back, focus returning to the button that opened it (`opener`). Composition templates follow the built-in
 * workflows under「组合」(34 §15.4).
 */
export function WorkflowPicker({
  id,
  open,
  workflows,
  templates,
  picked,
  pickedTemplate,
  opener,
  onPick,
  onPickTemplate,
  onClose,
}: {
  id: string;
  open: boolean;
  workflows: readonly WorkflowSummaryDTO[];
  templates: readonly InitiativeTemplateDTO[];
  picked: string | undefined;
  pickedTemplate: string | undefined;
  opener: RefObject<HTMLButtonElement | null>;
  onPick: (key: string) => void;
  onPickTemplate: (key: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!open) return;
    const chips = panel.current?.querySelectorAll<HTMLButtonElement>('button');
    const current = [...(chips ?? [])].find((c) => c.getAttribute('aria-pressed') === 'true');
    (current ?? chips?.[0])?.focus();
  }, [open]);
  const builtin = workflows.filter((w) => w.kind === WorkflowKind.Builtin);
  const custom = workflows.filter((w) => w.kind !== WorkflowKind.Builtin);
  const chip = (w: WorkflowSummaryDTO, i: number) => (
    <button
      key={w.id}
      type="button"
      className={styles.chip}
      style={{ '--i': i } as CSSProperties}
      aria-pressed={w.key === picked}
      title={w.description}
      onClick={() => onPick(w.key)}
    >
      <Icon name={workflowIcon(w.key)} size="sm" />
      {w.name}
    </button>
  );
  return (
    <fieldset
      ref={panel}
      id={id}
      aria-label={C.pickWorkflow}
      className={styles.flows}
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onClose();
        opener.current?.focus();
      }}
    >
      {builtin.map(chip)}
      {templates.length > 0 && (
        <>
          <span className={styles.flowsCap}>{INITIATIVES_COPY.templates}</span>
          {templates.map((t, i) => (
            <button
              key={t.key}
              type="button"
              className={styles.chip}
              style={{ '--i': builtin.length + i } as CSSProperties}
              aria-pressed={t.key === pickedTemplate}
              title={`${templateChain(t, workflows)}\n${t.description}`}
              onClick={() => onPickTemplate(t.key)}
            >
              <Icon name="split" size="sm" />
              {t.name}
            </button>
          ))}
        </>
      )}
      {custom.length > 0 && (
        <>
          <span className={styles.flowsCap}>{C.customWorkflows}</span>
          {custom.map((w, i) => chip(w, builtin.length + templates.length + i))}
        </>
      )}
    </fieldset>
  );
}
