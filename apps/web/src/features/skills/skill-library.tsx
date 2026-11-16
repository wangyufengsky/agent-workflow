import {
  AssistantForm,
  createSkillOp,
  deleteSkillOp,
  USER_SKILL_MAX_CHARS,
  type UserSkillDTO,
  updateSkillOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import { clearPendingForm, usePendingForm } from '../../state/ui.store.ts';
import styles from './skills.module.css';
import { skillsQuery } from './skills.queries.ts';

type Draft = { id?: string; source: string; title: string; assistant?: boolean };
const template = '---\nname: my-skill\ndescription: \n---\n\n';

function SkillEditor({ draft, onClose }: { draft: Draft; onClose(): void }) {
  const [source, setSource] = useState(draft.source);
  const sourceId = useId();
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      draft.id === undefined
        ? callOperation(createSkillOp, { source })
        : callOperation(updateSkillOp, { id: draft.id, source }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: skillsQuery.queryKey });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={draft.title}
      description={draft.assistant === true ? C.draftHint : C.sourceHint}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            pending={save.isPending}
            disabled={source.trim() === '' || source.length > USER_SKILL_MAX_CHARS}
          >
            {C.save}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor={sourceId}>
          {C.source}
        </label>
        <textarea
          id={sourceId}
          className={`input ${styles.source}`}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
        />
      </div>
      {source.length > USER_SKILL_MAX_CHARS && (
        <p role="alert" className="hint">
          {C.tooLong(USER_SKILL_MAX_CHARS)}
        </p>
      )}
      {save.isError && <ErrorState error={save.error} />}
    </Dialog>
  );
}

export function SkillLibrary() {
  const cache = useQueryClient();
  const library = useQuery(skillsQuery);
  const pending = usePendingForm(AssistantForm.CreateSkill);
  const [draft, setDraft] = useState<Draft>();
  const [deleting, setDeleting] = useState<UserSkillDTO>();
  const upload = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const remove = useMutation({
    mutationFn: (id: string) => callOperation(deleteSkillOp, { id }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: queryKeys.skills });
      setDeleting(undefined);
    },
  });
  const fromAssistant =
    typeof pending?.values.source === 'string'
      ? {
          source: pending.values.source,
          title: C.draft,
          assistant: true,
        }
      : undefined;
  const editing = draft ?? fromAssistant;

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
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
    <section id="my-skills">
      <Panel title={C.title}>
        <p className="hint">{C.subtitle}</p>
        <div className="row wrap">
          <Button icon="plus" onClick={() => setDraft({ source: template, title: C.create })}>
            {C.create}
          </Button>
          <Button icon="paperclip" onClick={() => upload.current?.click()}>
            {C.import}
          </Button>
          <input
            hidden
            ref={upload}
            type="file"
            aria-label={C.import}
            accept=".md,text/markdown"
            onChange={(e) => void readFile(e)}
          />
        </div>
        {importError !== undefined && (
          <p role="alert" className="hint">
            {importError}
          </p>
        )}
        {library.isPending && <span className="spin" />}
        {library.isError && <ErrorState error={library.error} onRetry={() => void library.refetch()} />}
        {library.data?.length === 0 && <p className="hint">{C.empty}</p>}
        <div className={styles.options}>
          {library.data?.map((skill) => (
            <div className={styles.option} key={skill.id}>
              <div className={styles.optionText}>
                <strong>
                  {skill.name} <span className="hint mono">{C.version(skill.version)}</span>
                </strong>
                <small>{skill.description}</small>
              </div>
              <Button size="sm" onClick={() => setDraft({ id: skill.id, source: skill.source, title: C.edit })}>
                {C.edit}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  remove.reset();
                  setDeleting(skill);
                }}
              >
                {C.delete}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
      {editing !== undefined && (
        <SkillEditor
          key={draft === undefined ? pending?.seq : (draft.id ?? draft.title)}
          draft={editing}
          onClose={() => {
            if (draft === undefined) clearPendingForm();
            else setDraft(undefined);
          }}
        />
      )}
      {deleting !== undefined && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(undefined);
          }}
          title={C.deleteTitle(deleting.name)}
          description={C.deleteHint}
          footer={
            <>
              <Button onClick={() => setDeleting(undefined)} disabled={remove.isPending}>
                {C.cancel}
              </Button>
              <Button variant="danger" pending={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {C.delete}
              </Button>
            </>
          }
        >
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </section>
  );
}
