import { AssistantForm, deleteSkillOp, USER_SKILL_MAX_CHARS } from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import { clearPendingForm, usePendingForm } from '../../state/ui.store.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { rolesQuery, workflowsQuery } from '../tasks/tasks.queries.ts';
import { audienceOptions, catalogEntries, matchesAudience, SkillAudience } from './skill-catalog.ts';
import { type SkillDraft, SkillEditor, skillTemplate } from './skill-editor.tsx';
import { SkillInspector } from './skill-inspector.tsx';
import { SkillScopeEditor } from './skill-scope-editor.tsx';
import styles from './skills.module.css';
import { skillCatalogQuery, skillsQuery } from './skills.queries.ts';

const kinds = ['all', 'mine', 'builtin'] as const;
type Kind = (typeof kinds)[number];

export function SkillLibraryPage() {
  const cache = useQueryClient();
  const library = useQuery(skillsQuery);
  const catalog = useQuery(skillCatalogQuery);
  const projects = useQuery(projectsQuery);
  const workflows = useQuery(workflowsQuery);
  const roles = useQuery(rolesQuery);
  const pending = usePendingForm(AssistantForm.CreateSkill);
  const [draft, setDraft] = useState<SkillDraft>();
  const [scopeId, setScopeId] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filter, setFilter] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState('');
  const [selected, setSelected] = useState<string>();
  const upload = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const remove = useMutation({
    mutationFn: (id: string) => callOperation(deleteSkillOp, { id }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: queryKeys.skills });
      setDeleteOpen(false);
    },
  });

  const queries = [library, catalog, projects, workflows, roles];
  const loading = queries.some((query) => query.isPending);
  const loadError = queries.find((query) => query.isError)?.error;
  const options = { roles: roles.data ?? [], workflows: workflows.data ?? [], projects: projects.data ?? [] };
  const entries = catalogEntries(
    library.data ?? [],
    catalog.data?.builtin ?? [],
    catalog.data?.scopes ?? [],
    options.roles,
  );
  const keyword = search.trim().toLocaleLowerCase();
  const shown = entries.filter(
    (entry) =>
      (filter === 'all' || entry.kind === filter) &&
      matchesAudience(entry, audience, options.roles) &&
      [entry.title, entry.name, entry.description].some((text) => text.toLocaleLowerCase().includes(keyword)),
  );
  const active = shown.find(({ id }) => id === selected) ?? shown[0];
  const scopeTarget = entries.find((entry) => entry.id === scopeId);
  const fromAssistant =
    typeof pending?.values.source === 'string'
      ? { source: pending.values.source, title: C.draft, assistant: true }
      : undefined;
  const editing = draft ?? fromAssistant;

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    setImportError(undefined);
    if (file.size > USER_SKILL_MAX_CHARS * 4) {
      setImportError(C.tooLong(USER_SKILL_MAX_CHARS));
      return;
    }
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setDraft({ source, title: C.import });
    } catch {
      setImportError(C.importError);
    }
  }

  return (
    <div id="my-skills" className={`page wide ${styles.library}`}>
      <header className={styles.banner}>
        <div>
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.subtitle}</p>
        </div>
        <div className="row wrap">
          <Button icon="paperclip" onClick={() => upload.current?.click()}>
            {C.import}
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setDraft({ source: skillTemplate, title: C.create })}>
            {C.create}
          </Button>
          <input
            hidden
            ref={upload}
            type="file"
            aria-label={C.import}
            accept=".md,text/markdown"
            onChange={(event) => void readFile(event)}
          />
        </div>
      </header>
      {importError !== undefined && (
        <p role="alert" className="hint">
          {importError}
        </p>
      )}
      {loading && <span className="spin" />}
      {loadError != null && (
        <ErrorState
          error={loadError}
          onRetry={() => void Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()))}
        />
      )}
      {!loading && loadError == null && (
        <>
          <div className={styles.toolbar}>
            <fieldset className={styles.filters} aria-label={C.library}>
              {kinds.map((kind) => (
                <button
                  className={styles.filter}
                  type="button"
                  key={kind}
                  aria-pressed={filter === kind}
                  onClick={() => setFilter(kind)}
                >
                  {C[kind]} <span>{entries.filter((entry) => kind === 'all' || entry.kind === kind).length}</span>
                </button>
              ))}
            </fieldset>
            <div className={styles.filters}>
              <label className={styles.search}>
                <Icon name="search" size="sm" />
                <input
                  className="input"
                  type="search"
                  aria-label={C.search}
                  placeholder={C.searchPlaceholder}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <select
                className="input"
                aria-label={C.filterAudience}
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="">{C.allAudiences}</option>
                {audienceOptions(options.roles).map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                <option value={SkillAudience.Unconfigured}>{C.unconfigured}</option>
              </select>
            </div>
          </div>
          <div className={styles.workspace}>
            <section className={styles.list} aria-label={C.library}>
              <div className={styles.columns}>
                <span>Skill</span>
                <span>{C.audience}</span>
              </div>
              {shown.length === 0 && <p className="hint">{C.noMatches}</p>}
              {shown.map((entry) => {
                const who = [...entry.audiences.map(({ name }) => name), ...(entry.allRoles ? [C.allRoles] : [])];
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={styles.entry}
                    aria-pressed={active?.id === entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    <span className={styles.entryTitle}>
                      <strong>{entry.title}</strong>
                      <small>{C[entry.kind]}</small>
                    </span>
                    <span className={styles.entryAudience}>
                      {who.length === 0 ? C.unconfigured : who.slice(0, 2).join(' / ')}
                      {who.length > 2 ? ` +${who.length - 2}` : ''}
                    </span>
                  </button>
                );
              })}
            </section>
            {active !== undefined && (
              <SkillInspector
                key={active.id}
                entry={active}
                options={options}
                onEditScope={() => setScopeId(active.id)}
                onEditSource={() => setDraft({ id: active.id, source: active.source, title: C.edit })}
                onDelete={() => {
                  remove.reset();
                  setDeleteOpen(true);
                }}
              />
            )}
          </div>
        </>
      )}
      {editing !== undefined && (
        <SkillEditor
          key={draft === undefined ? pending?.seq : (draft.id ?? draft.title)}
          draft={editing}
          onSaved={(id) => {
            setFilter('mine');
            setSearch('');
            setAudience('');
            setSelected(id);
          }}
          onClose={() => {
            if (draft === undefined) clearPendingForm();
            else setDraft(undefined);
          }}
        />
      )}
      {scopeTarget?.kind === 'mine' && (
        <SkillScopeEditor scope={scopeTarget.scope} options={options} onClose={() => setScopeId(undefined)} />
      )}
      {deleteOpen && active?.kind === 'mine' && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleteOpen(false);
          }}
          title={C.deleteTitle(active.name)}
          description={C.deleteHint}
          footer={
            <>
              <Button disabled={remove.isPending} onClick={() => setDeleteOpen(false)}>
                {C.cancel}
              </Button>
              <Button variant="danger" pending={remove.isPending} onClick={() => remove.mutate(active.id)}>
                {C.delete}
              </Button>
            </>
          }
        >
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </div>
  );
}
