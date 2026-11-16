import {
  type ProjectDTO,
  type RoleDTO,
  type SkillBindingScope,
  setSkillScopeOp,
  type UserSkillScope,
  type WorkflowSummaryDTO,
} from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import styles from './skills.module.css';

export type ScopeOptions = { projects: ProjectDTO[]; workflows: WorkflowSummaryDTO[]; roles: RoleDTO[] };
type BindingDraft = SkillBindingScope & { key: string };

function BindingFields({
  row,
  index,
  options,
  onChange,
  onRemove,
}: {
  row: BindingDraft;
  index: number;
  options: ScopeOptions;
  onChange(changes: Partial<SkillBindingScope>): void;
  onRemove(): void;
}) {
  const roleIds = row.roleIds ?? [];
  return (
    <fieldset className={styles.bindingFields}>
      <legend>{C.bindingNumber(index + 1)}</legend>
      <div className={styles.bindingTargets}>
        <label className="field">
          <span className="label">{C.project}</span>
          <select
            className="input"
            value={row.projectId}
            onChange={(event) => onChange({ projectId: event.target.value })}
          >
            <option value="">{C.pickProject}</option>
            {options.projects.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{C.workflow}</span>
          <select
            className="input"
            value={row.workflowKey}
            onChange={(event) => onChange({ workflowKey: event.target.value })}
          >
            <option value="">{C.pickWorkflow}</option>
            {options.workflows.map(({ key, name }) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="label">{C.matchingRoles}</span>
        <select
          className="input"
          value={row.roleIds === null ? 'all' : 'specific'}
          onChange={(event) => onChange({ roleIds: event.target.value === 'all' ? null : [] })}
        >
          <option value="all">{C.allRoles}</option>
          <option value="specific">{C.chooseRoles}</option>
        </select>
      </label>
      {row.roleIds !== null && (
        <div className={styles.roleOptions}>
          {options.roles.map(({ id, name }) => (
            <label className="check" key={id}>
              <input
                type="checkbox"
                checked={roleIds.includes(id)}
                onChange={(event) =>
                  onChange({ roleIds: event.target.checked ? [...roleIds, id] : roleIds.filter((role) => role !== id) })
                }
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
      <div>
        <Button variant="ghost" size="sm" icon="x" onClick={onRemove}>
          {C.removeBinding}
        </Button>
      </div>
    </fieldset>
  );
}

export function SkillScopeEditor({
  scope,
  options,
  onClose,
}: {
  scope: UserSkillScope;
  options: ScopeOptions;
  onClose(): void;
}) {
  const cache = useQueryClient();
  const [assistantEnabled, setAssistantEnabled] = useState(scope.assistantEnabled);
  const [draft, setDraft] = useState<BindingDraft[]>(() =>
    scope.bindings.map((binding) => ({ ...binding, key: crypto.randomUUID() })),
  );
  const bindings = draft.map(({ key: _key, ...binding }) => binding);
  const incomplete = bindings.some(
    (row) => row.projectId === '' || row.workflowKey === '' || row.roleIds?.length === 0,
  );
  const duplicate =
    new Set(bindings.map(({ projectId, workflowKey }) => JSON.stringify([projectId, workflowKey]))).size !==
    bindings.length;
  const save = useMutation({
    mutationFn: () => callOperation(setSkillScopeOp, { id: scope.id, assistantEnabled, bindings }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: queryKeys.skills });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={C.editScope}
      description={C.editScopeHint}
      footer={
        <>
          <Button disabled={save.isPending} onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={incomplete || duplicate}
            onClick={() => save.mutate()}
          >
            {C.save}
          </Button>
        </>
      }
    >
      <div className={styles.scopeDraft}>
        <label className="check">
          <input
            type="checkbox"
            checked={assistantEnabled}
            onChange={(event) => setAssistantEnabled(event.target.checked)}
          />
          <span>{C.assistantToggle}</span>
        </label>
        {draft.map((row, index) => (
          <BindingFields
            key={row.key}
            row={row}
            index={index}
            options={options}
            onChange={(changes) =>
              setDraft((current) => current.map((item) => (item.key === row.key ? { ...item, ...changes } : item)))
            }
            onRemove={() => setDraft((current) => current.filter((item) => item.key !== row.key))}
          />
        ))}
        <div>
          <Button
            icon="plus"
            disabled={options.projects.length === 0 || options.workflows.length === 0}
            onClick={() =>
              setDraft((current) => [
                ...current,
                { key: crypto.randomUUID(), projectId: '', workflowKey: '', roleIds: null },
              ])
            }
          >
            {C.addBinding}
          </Button>
        </div>
        {incomplete && <p className="hint">{C.incompleteScope}</p>}
        {duplicate && (
          <p role="alert" className="hint">
            {C.duplicateScope}
          </p>
        )}
        {save.isError && <ErrorState error={save.error} />}
      </div>
    </Dialog>
  );
}
