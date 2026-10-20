import { DEFINITION_KEY_PATTERN, RoleBaseAgent, type RoleDTO, RoleKind, roleBaseAgentSchema } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ROLES_COPY as C } from '../../copy/roles.ts';
import { ROLE_BASE_AGENT_LABEL, WORKFLOWS_COPY } from '../../copy/workflows.ts';
import { environmentQuery } from '../onboarding/environment.queries.ts';
import { rolesQuery, useCreateRole, useDeleteRole, useUpdateRole } from '../tasks/tasks.queries.ts';
import styles from './roles.module.css';

type Editing = { mode: 'create' } | { mode: 'copy'; from: RoleDTO } | { mode: 'edit'; role: RoleDTO };

/** Models opencode offers (`provider/model`), from the environment check (M5-06). */
function ModelSelect({ value, onChange }: { value: string | null; onChange: (model: string | null) => void }) {
  const environment = useQuery(environmentQuery);
  const models = environment.data?.models.available ?? [];
  const ids = models.map((m) => `${m.providerId}/${m.modelId}`);
  return (
    <div className="field">
      <label className="label" htmlFor="role-model">
        {C.model}
      </label>
      <select
        id="role-model"
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{C.defaultModel}</option>
        {value !== null && !ids.includes(value) && <option value={value}>{value}</option>}
        {models.map((m) => (
          <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>
            {m.name}（{m.providerId}/{m.modelId}）
          </option>
        ))}
      </select>
      {environment.data !== undefined && models.length === 0 && <span className="hint">{C.modelsUnavailable}</span>}
    </div>
  );
}

function RoleDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const source = editing.mode === 'copy' ? editing.from : editing.mode === 'edit' ? editing.role : undefined;
  const [key, setKey] = useState(editing.mode === 'copy' ? `${editing.from.key}_copy` : (source?.key ?? ''));
  const [name, setName] = useState(editing.mode === 'copy' ? C.copyName(editing.from.name) : (source?.name ?? ''));
  const [description, setDescription] = useState(source?.description ?? '');
  const [baseAgent, setBaseAgent] = useState<RoleBaseAgent>(source?.baseAgent ?? RoleBaseAgent.Executor);
  const [prompt, setPrompt] = useState(source?.prompt ?? '');
  const [model, setModel] = useState<string | null>(source?.model ?? null);
  const create = useCreateRole();
  const update = useUpdateRole();
  const mutation = editing.mode === 'edit' ? update : create;
  const keyValid = DEFINITION_KEY_PATTERN.test(key);
  const valid = (editing.mode === 'edit' || keyValid) && name.trim() !== '' && prompt.trim() !== '';
  const done = (message: string) => () => {
    toast(message);
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields = { name: name.trim(), description, prompt, model };
    if (editing.mode === 'edit') update.mutate({ id: editing.role.id, ...fields }, { onSuccess: done(C.saved) });
    else if (editing.mode === 'copy') {
      create.mutate({ key, copyFrom: editing.from.id, ...fields }, { onSuccess: done(C.created) });
    } else create.mutate({ key, baseAgent, ...fields }, { onSuccess: done(C.created) });
  };
  const title = editing.mode === 'edit' ? editing.role.name : editing.mode === 'copy' ? C.copy : C.create;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={title}>
      <form className="col" onSubmit={submit}>
        {editing.mode !== 'edit' && (
          <div className="field">
            <label className="label" htmlFor="role-key">
              {C.key}
            </label>
            <input
              id="role-key"
              className="input mono"
              value={key}
              aria-invalid={!keyValid}
              onChange={(e) => setKey(e.target.value)}
            />
            <span className={keyValid || key === '' ? 'hint' : 'error-text'}>{WORKFLOWS_COPY.keyHint}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="role-name">
            {C.name}
          </label>
          <input id="role-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="role-description">
            {C.description}
          </label>
          <input
            id="role-description"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="role-base">
            {C.baseAgent}
          </label>
          <select
            id="role-base"
            className="select"
            value={baseAgent}
            disabled={editing.mode !== 'create'}
            onChange={(e) => setBaseAgent(roleBaseAgentSchema.parse(e.target.value))}
          >
            {Object.values(RoleBaseAgent).map((agent) => (
              <option key={agent} value={agent}>
                {ROLE_BASE_AGENT_LABEL[agent]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="role-prompt">
            {C.prompt}
          </label>
          <textarea
            id="role-prompt"
            className="textarea mono"
            rows={10}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <span className="hint">{C.promptHint}</span>
        </div>
        <ModelSelect value={model} onChange={setModel} />
        {mutation.isError && <ErrorState error={mutation.error} />}
        <div className="row">
          <Button type="submit" variant="primary" pending={mutation.isPending} disabled={!valid}>
            {COMMON_COPY.save}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: RoleDTO; onClose: () => void }) {
  const remove = useDeleteRole();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.deleteTitle(role.name)}
      footer={
        <Button
          variant="danger"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(role.id, {
              onSuccess: () => {
                toast(C.deleted);
                onClose();
              },
            })
          }
        >
          {C.delete}
        </Button>
      }
    >
      <p>{C.deleteBody}</p>
      {remove.isError && <ErrorState error={remove.error} />}
    </Dialog>
  );
}

/** Roles (M5-06, 14 §7 #8): name, description, base type, prompt and model; built-in ones are copied to change. */
export function RolesPage() {
  const roles = useQuery(rolesQuery);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<RoleDTO | undefined>(undefined);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing({ mode: 'create' })}>
          {C.create}
        </Button>
      </div>
      {roles.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {roles.isError && <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />}
      <div className="grid-2">
        {roles.data?.map((role) => (
          <article key={role.id} className="card pad col" aria-label={role.name}>
            <span className="row">
              <span className="tile">
                <Icon name="users" />
              </span>
              <span className="section-title grow ellipsis">{role.name}</span>
              {role.kind === RoleKind.Builtin && <span className="chip">{C.readonly}</span>}
            </span>
            <span className="hint">{role.description}</span>
            <span className={styles.meta}>
              <span className="mono">{role.key}</span> · {ROLE_BASE_AGENT_LABEL[role.baseAgent]} ·{' '}
              <span className="mono">{role.model ?? C.defaultModel}</span>
            </span>
            <div className="row">
              {role.kind === RoleKind.Custom && (
                <Button size="sm" icon="edit" onClick={() => setEditing({ mode: 'edit', role })}>
                  {C.edit}
                </Button>
              )}
              <Button size="sm" icon="copy" onClick={() => setEditing({ mode: 'copy', from: role })}>
                {C.copy}
              </Button>
              {role.kind === RoleKind.Custom && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(role)}>
                  {C.delete}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing !== undefined && <RoleDialog editing={editing} onClose={() => setEditing(undefined)} />}
      {deleting !== undefined && <DeleteRoleDialog role={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
