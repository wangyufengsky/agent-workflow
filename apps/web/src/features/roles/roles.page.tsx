import {
  APPROVER_ROLE_KEY,
  DEFINITION_KEY_PATTERN,
  IMAGE_PROCESSOR_ROLE_KEY,
  type ModelEffort,
  RoleBaseAgent,
  type RoleDTO,
  RoleKind,
  roleBaseAgentSchema,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ModelEffortField, ModelFields } from '../../components/model-effort-field.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ROLES_COPY as C } from '../../copy/roles.ts';
import { ROLE_BASE_AGENT_LABEL, WORKFLOWS_COPY } from '../../copy/workflows.ts';
import { environmentQuery } from '../onboarding/environment.queries.ts';
import { usableModels } from '../onboarding/usable-models.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { rolesQuery, useCreateRole, useDeleteRole, useUpdateRole } from '../tasks/tasks.queries.ts';
import styles from './roles.module.css';

type Editing = { mode: 'create' } | { mode: 'copy'; from: RoleDTO } | { mode: 'edit'; role: RoleDTO };

/** Models opencode offers (`provider/model`), from the environment check (M5-06). */
function ModelSelect({
  value,
  onChange,
  effort,
  onEffort,
  image = false,
  disabled = false,
}: {
  effort: ModelEffort | null;
  onEffort: (v: ModelEffort | null) => void;
  image?: boolean;
  disabled?: boolean;
  value: string | null;
  onChange: (model: string | null) => void;
}) {
  const modelId = useId();
  const environment = useQuery(environmentQuery);
  // A role's model applies in every project: only the global configuration's (D162).
  const settings = useSettings();
  const models = usableModels(environment.data?.models.available ?? [], null).filter((m) => !image || m.supportsImage);
  const ids = models.map((m) => `${m.providerId}/${m.modelId}`);
  const inherited = settings['ai.defaultModel'] ?? environment.data?.models.defaultModel;
  const incompatible = image && !!environment.data && !ids.includes(inherited ?? '');
  return (
    <ModelFields>
      <div className="field">
        <label className="label" htmlFor={modelId}>
          {C.model}
        </label>
        <select
          disabled={disabled}
          id={modelId}
          className="select"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="" disabled={incompatible}>
            {C.defaultModel}
            {inherited ? ' · ' + inherited : ''}
          </option>
          {value !== null && !ids.includes(value) && (
            <option disabled value={value}>
              {value}
            </option>
          )}
          {models.map((m) => (
            <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>
              {m.name}（{m.providerId}/{m.modelId}）
            </option>
          ))}
        </select>
        {incompatible && value === null && <span className="hint">{C.visionRequired}</span>}
        {environment.data !== undefined && models.length === 0 && <span className="hint">{C.modelsUnavailable}</span>}
      </div>
      <ModelEffortField
        model={models.find((m) => m.providerId + '/' + m.modelId === (value ?? inherited))}
        value={effort}
        {...(value === null ? { inherited: settings['ai.defaultEffort'] } : {})}
        disabled={disabled}
        onChange={onEffort}
      />
    </ModelFields>
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
  const [effort, setEffort] = useState(source?.effort ?? null);
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
    const fields = {
      name: name.trim(),
      description,
      prompt,
      model,
      ...(source?.model === model && source.effort === effort ? {} : { effort }),
    };
    if (editing.mode === 'edit') update.mutate({ id: editing.role.id, ...fields }, { onSuccess: done(C.saved) });
    else if (editing.mode === 'copy') {
      create.mutate({ key, copyFrom: editing.from.id, ...fields }, { onSuccess: done(C.created) });
    } else create.mutate({ key, baseAgent, ...fields }, { onSuccess: done(C.created) });
  };
  const title = editing.mode === 'edit' ? editing.role.name : editing.mode === 'copy' ? C.copy : C.create;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={title}>
      <form className={styles.form} onSubmit={submit}>
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
        <ModelSelect
          value={model}
          effort={effort}
          onEffort={setEffort}
          onChange={(v) => {
            setModel(v);
            setEffort(null);
          }}
        />
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
  const [selected, setSelected] = useState<string>();
  const update = useUpdateRole();
  const active = roles.data?.find((r) => r.id === selected) ?? roles.data?.[0];
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
      {active && (
        <div className={styles.layout}>
          <nav className={styles.list} aria-label={C.title}>
            {[RoleKind.Builtin, RoleKind.Custom].map((kind) => {
              const group = roles.data?.filter((r) => r.kind === kind);
              if (!group?.length) return null;
              return (
                <section key={kind}>
                  <h2 className="hint">{kind === RoleKind.Builtin ? C.readonly : C.custom}</h2>
                  {group.map((r) => (
                    <button
                      type="button"
                      className={styles.role}
                      aria-pressed={r.id === active.id}
                      key={r.id}
                      onClick={() => {
                        update.reset();
                        setSelected(r.id);
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                </section>
              );
            })}
          </nav>
          <article className={`card ${styles.detail}`} aria-label={active.name}>
            <header className={styles.identity}>
              <span className="hint">{active.kind === RoleKind.Builtin ? C.locked : C.custom}</span>
              <h2>{active.name}</h2>
              <p>{active.description}</p>
            </header>
            <div className={styles.configuration}>
              <ModelSelect
                value={active.model}
                effort={active.effort}
                onEffort={(effort) => update.mutate({ id: active.id, effort })}
                image={active.key === IMAGE_PROCESSOR_ROLE_KEY}
                disabled={update.isPending}
                onChange={(model) => update.mutate({ id: active.id, model })}
              />
              {active.model === null && (
                <Link className="hint" to={ROUTES.settings} hash="setting-model">
                  {C.globalSettings}
                </Link>
              )}
              {update.isError && <ErrorState error={update.error} />}
            </div>
            <details className={styles.disclosure} open={active.key === APPROVER_ROLE_KEY} key={active.id}>
              <summary>{active.key === APPROVER_ROLE_KEY ? C.approvalRules : C.prompt}</summary>
              {active.key === APPROVER_ROLE_KEY ? (
                <dl>
                  {C.approvalCases.map(([name, body]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{body}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className={styles.prompt}>{active.prompt}</p>
              )}
            </details>
            <footer className={styles.actions}>
              {active.kind === RoleKind.Custom && (
                <Button size="sm" icon="edit" onClick={() => setEditing({ mode: 'edit', role: active })}>
                  {C.edit}
                </Button>
              )}
              <Button size="sm" icon="copy" onClick={() => setEditing({ mode: 'copy', from: active })}>
                {C.copy}
              </Button>
              {active.kind === RoleKind.Custom && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(active)}>
                  {C.delete}
                </Button>
              )}
            </footer>
          </article>
        </div>
      )}
      {editing !== undefined && <RoleDialog editing={editing} onClose={() => setEditing(undefined)} />}
      {deleting !== undefined && <DeleteRoleDialog role={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
