import { type InitiativeTemplateDTO, InitiativeTemplateKind, WorkflowKind, type WorkflowSummaryDTO } from '@aw/shared';
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { HOME_COPY as C } from '../../copy/home.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { templateChain } from '../initiatives/use-start-initiative.ts';
import styles from './home.module.css';
import { PRIMARY_WORKFLOWS, workflowIcon } from './workflow-icon.ts';

/**
 * The workflows under「直接开始」(36 §5, D145): inside the box, above its foot, folded until asked for. Opening moves
 * focus to the picked workflow or the first one — the panel comes before the foot, so Tab would skip it — and Esc
 * folds it back, focus returning to the button that opened it (`opener`). Composition templates follow the built-in
 * workflows under「组合」(34 §15.4); custom ones join the custom workflows under「自定义」(pro mode, 34 §15.6).
 * Only the five common built-in workflows show as chips; the others unfold under「更多流程」, each with what it does
 * (38 C2, D158), already unfolded when one of them is picked.
 */
export function WorkflowPicker({
  id,
  open,
  workflows,
  templates,
  picked,
  pickedTemplate,
  pickedBreakdown,
  opener,
  onPick,
  onPickTemplate,
  onPickBreakdown,
  onClose,
}: {
  id: string;
  open: boolean;
  workflows: readonly WorkflowSummaryDTO[];
  templates: readonly InitiativeTemplateDTO[];
  picked: string | undefined;
  pickedTemplate: string | undefined;
  pickedBreakdown: boolean;
  opener: RefObject<HTMLButtonElement | null>;
  onPick: (key: string) => void;
  onPickTemplate: (key: string) => void;
  onPickBreakdown: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!open) return;
    const chips = panel.current?.querySelectorAll<HTMLButtonElement>('button');
    const current = [...(chips ?? [])].find((c) => c.getAttribute('aria-pressed') === 'true');
    (current ?? chips?.[0])?.focus();
  }, [open]);
  const allBuiltin = workflows.filter((w) => w.kind === WorkflowKind.Builtin);
  const builtin = allBuiltin.filter((w) => PRIMARY_WORKFLOWS.includes(w.key));
  const more = allBuiltin.filter((w) => !PRIMARY_WORKFLOWS.includes(w.key));
  const [moreOpen, setMoreOpen] = useState(() => more.some((w) => w.key === picked));
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
  const builtinTemplates = templates.filter((t) => t.kind === InitiativeTemplateKind.Builtin);
  const customTemplates = templates.filter((t) => t.kind !== InitiativeTemplateKind.Builtin);
  const templateChip = (t: InitiativeTemplateDTO, i: number) => (
    <button
      key={t.key}
      type="button"
      className={styles.chip}
      style={{ '--i': i } as CSSProperties}
      aria-pressed={t.key === pickedTemplate}
      title={`${templateChain(t, workflows)}\n${t.description}`}
      onClick={() => onPickTemplate(t.key)}
    >
      <Icon name="split" size="sm" />
      {t.name}
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
      {more.length > 0 && (
        <button
          type="button"
          className={styles.chip}
          style={{ '--i': builtin.length } as CSSProperties}
          aria-expanded={moreOpen}
          aria-controls={`${id}-more`}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          {C.moreWorkflows(more.length)}
          <span className={styles.flowsChevron}>
            <Icon name="chevDown" size="sm" />
          </span>
        </button>
      )}
      <ul id={`${id}-more`} className={styles.moreFlows} aria-label={C.moreWorkflowsLabel} hidden={!moreOpen}>
        {more.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className={styles.moreFlow}
              aria-pressed={w.key === picked}
              onClick={() => onPick(w.key)}
            >
              <Icon name={workflowIcon(w.key)} size="sm" />
              <span className={styles.moreFlowName}>{w.name}</span>
              <span className={styles.moreFlowHint}>{w.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <span className={styles.flowsCap}>{INITIATIVES_COPY.templates}</span>
      <button
        type="button"
        className={styles.chip}
        style={{ '--i': builtin.length + 1 } as CSSProperties}
        aria-pressed={pickedBreakdown}
        title={INITIATIVES_COPY.aiBreakdownDescription}
        onClick={onPickBreakdown}
      >
        <Icon name="sparkle" size="sm" />
        {INITIATIVES_COPY.aiBreakdown}
      </button>
      {builtinTemplates.map((t, i) => templateChip(t, builtin.length + 2 + i))}
      {custom.length + customTemplates.length > 0 && (
        <>
          <span className={styles.flowsCap}>{C.customWorkflows}</span>
          {custom.map((w, i) => chip(w, builtin.length + 2 + builtinTemplates.length + i))}
          {customTemplates.map((t, i) =>
            templateChip(t, builtin.length + 2 + builtinTemplates.length + custom.length + i),
          )}
        </>
      )}
    </fieldset>
  );
}
