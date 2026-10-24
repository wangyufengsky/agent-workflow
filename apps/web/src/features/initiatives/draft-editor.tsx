import {
  type InitiativeDetailDTO,
  type InitiativeDraft,
  type InitiativeItemDTO,
  InitiativeItemStatus,
  WorkflowKind,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type Dispatch, type ReactNode, type SetStateAction, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { INITIATIVES_COPY as C } from '../../copy/initiatives.ts';
import { draftsOfInputs, inputsOf } from '../requirements/checklist-editor.tsx';
import { ChecklistField } from '../requirements/checklist-field.tsx';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './initiatives.module.css';
import { useSaveInitiativeDraft } from './initiatives.queries.ts';

type DraftItem = InitiativeDraft['items'][number];

/** A work package that started, finished or was dropped stays as it is (34 §5.2, ITEM_NOT_EDITABLE). */
const isLocked = (item: InitiativeItemDTO) => item.task !== null || item.status === InitiativeItemStatus.Dropped;

export const toDraft = (initiative: InitiativeDetailDTO): InitiativeDraft => ({
  phases: initiative.phases.map(({ title, goal, autoOpen }) => ({ title, goal, autoOpen })),
  items: initiative.items.map(({ key, title, phase, workflow, requirement, dependsOn, acceptance }) => ({
    key,
    title,
    phase,
    workflow,
    requirement,
    dependsOn,
    acceptance,
  })),
});

/** The next free key `item_<n>` for a new work package. */
const nextKey = (items: readonly DraftItem[]) => {
  let n = items.length + 1;
  while (items.some((i) => i.key === `item_${n}`)) n++;
  return `item_${n}`;
};

/**
 * The phases and work packages of a draft (34 §5.2) or a template (34 §15.6): titles, phases, workflows, dependencies
 * and requirements. `locked` work packages and the first `lockedPhases` phases stay as they are.
 */
export function DraftFields({
  draft,
  setDraft,
  locked = new Set(),
  lockedPhases = 0,
  actions,
}: {
  draft: InitiativeDraft;
  setDraft: Dispatch<SetStateAction<InitiativeDraft>>;
  locked?: ReadonlySet<string>;
  lockedPhases?: number;
  /** After 添加工作包: the editor's own buttons. */
  actions: ReactNode;
}) {
  const workflows = (useQuery(workflowsQuery).data ?? []).filter((w) => w.kind !== WorkflowKind.System);
  const setItem = (key: string, change: Partial<DraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...change } : i)) }));
  const setPhase = (index: number, change: Partial<InitiativeDraft['phases'][number]>) =>
    setDraft((d) => ({ ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, ...change } : p)) }));

  return (
    <>
      {draft.phases.map((phase, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: phases are positional, their number is what items refer to
        <div key={index} className={styles.phaseHead}>
          <span className="hint">{C.phaseShort(index + 1)}</span>
          <input
            className="input grow"
            aria-label={`${C.phaseShort(index + 1)} · ${C.fields.phaseTitle}`}
            value={phase.title}
            disabled={index < lockedPhases}
            onChange={(e) => setPhase(index, { title: e.target.value })}
          />
          {index > 0 && (
            <label className="check">
              <input
                type="checkbox"
                checked={phase.autoOpen}
                disabled={index < lockedPhases}
                onChange={(e) => setPhase(index, { autoOpen: e.target.checked })}
              />
              <span>{C.fields.autoOpen}</span>
            </label>
          )}
        </div>
      ))}
      <div className="row">
        <Button
          size="sm"
          icon="plus"
          onClick={() => setDraft((d) => ({ ...d, phases: [...d.phases, { title: '', goal: '', autoOpen: false }] }))}
        >
          {C.addPhase}
        </Button>
      </div>
      {draft.items.map((item) => {
        const frozen = locked.has(item.key);
        return (
          <fieldset key={item.key} className={styles.editItem} disabled={frozen} aria-label={item.title || item.key}>
            <label className="col">
              <span className="hint">{C.fields.title}</span>
              <input
                className="input"
                value={item.title}
                onChange={(e) => setItem(item.key, { title: e.target.value })}
              />
            </label>
            <label className="col">
              <span className="hint">{C.fields.phase}</span>
              <select
                className="select"
                value={item.phase}
                onChange={(e) => setItem(item.key, { phase: Number(e.target.value) })}
              >
                {draft.phases.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  <option key={i} value={i + 1}>
                    {C.phaseShort(i + 1)}
                    {p.title === '' ? '' : ` · ${p.title}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="col">
              <span className="hint">{C.fields.workflow}</span>
              <select
                className="select"
                value={item.workflow}
                onChange={(e) => setItem(item.key, { workflow: e.target.value })}
              >
                {workflows.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="input"
              rows={3}
              aria-label={`${item.title || item.key} · ${C.fields.requirement}`}
              value={item.requirement}
              onChange={(e) => setItem(item.key, { requirement: e.target.value })}
            />
            {/* The acceptance checklist (31) the work package's task starts with. */}
            <div className={styles.wide}>
              <ChecklistField
                drafts={draftsOfInputs(item.acceptance, item.key)}
                onChange={(drafts) => setItem(item.key, { acceptance: inputsOf(drafts) })}
              />
            </div>
            <div className={styles.deps}>
              <span className="hint">{C.fields.dependsOn}</span>
              {draft.items
                .filter((other) => other.key !== item.key)
                .map((other) => (
                  <label key={other.key} className="check">
                    <input
                      type="checkbox"
                      checked={item.dependsOn.includes(other.key)}
                      onChange={(e) =>
                        setItem(item.key, {
                          dependsOn: e.target.checked
                            ? [...item.dependsOn, other.key]
                            : item.dependsOn.filter((k) => k !== other.key),
                        })
                      }
                    />
                    <span>{other.title || other.key}</span>
                  </label>
                ))}
            </div>
            <div className={styles.wide}>
              {frozen ? (
                <span className="hint">{C.locked}</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      items: d.items
                        .filter((i) => i.key !== item.key)
                        .map((i) => ({ ...i, dependsOn: i.dependsOn.filter((k) => k !== item.key) })),
                    }))
                  }
                >
                  {C.removeItem}
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="row">
        <Button
          size="sm"
          icon="plus"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              items: [
                ...d.items,
                {
                  key: nextKey(d.items),
                  title: '',
                  phase: d.phases.length,
                  workflow: workflows[0]?.key ?? 'feature',
                  requirement: '',
                  dependsOn: [],
                  acceptance: [],
                },
              ],
            }))
          }
        >
          {C.addItem}
        </Button>
        <span className="grow" />
        {actions}
      </div>
    </>
  );
}

/**
 * Editing the phases and the work packages that have not started (34 §5.2). The server checks the whole draft
 * (`validateInitiativeDraft`) and says what is wrong.
 */
export function DraftEditor({ initiative, onDone }: { initiative: InitiativeDetailDTO; onDone: () => void }) {
  const [draft, setDraft] = useState(() => toDraft(initiative));
  const save = useSaveInitiativeDraft();
  return (
    <section className="card pad col" data-testid="initiative-editor">
      <h2 className="section-title">{C.edit}</h2>
      <DraftFields
        draft={draft}
        setDraft={setDraft}
        locked={new Set(initiative.items.filter(isLocked).map((i) => i.key))}
        lockedPhases={initiative.openedPhase}
        actions={
          <>
            <Button onClick={onDone}>{C.cancel}</Button>
            <Button
              variant="primary"
              pending={save.isPending}
              onClick={() => save.mutate({ id: initiative.id, ...draft }, { onSuccess: onDone })}
            >
              {C.save}
            </Button>
          </>
        }
      />
      {save.isError && <ErrorState error={save.error} />}
    </section>
  );
}
