import {
  DESIGN_INSTRUCTION_MAX_CHARS,
  DESIGN_MAX_SECTIONS,
  DESIGN_TITLE_MAX_CHARS,
  DesignSectionKind,
  type DesignTemplate,
  DesignTemplateKind,
  type DesignTemplateSection,
  designSectionKindSchema,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGNS_COPY as C, DESIGN_SECTION_LABEL } from '../../copy/designs.ts';
import styles from './designs.module.css';
import {
  designTemplatesQuery,
  useCreateDesignTemplate,
  useDeleteDesignTemplate,
  useUpdateDesignTemplate,
} from './designs.queries.ts';

type Editor = { base?: DesignTemplate; copy: boolean };
type DraftSection = { key: string; section: DesignTemplateSection };
const draftSection = (section: DesignTemplateSection): DraftSection => ({ key: crypto.randomUUID(), section });
const emptySection: DesignTemplateSection = { kind: DesignSectionKind.Custom, title: '', scopeHint: '' };

function TemplateEditor({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const { base, copy } = editor;
  const editing = base !== undefined && !copy;
  const [name, setName] = useState(base === undefined ? '' : copy ? C.templateCopy(base.name) : base.name);
  const [description, setDescription] = useState(base?.description ?? '');
  const [focusPrompt, setFocusPrompt] = useState(base?.focusPrompt ?? '');
  const [sections, setSections] = useState(() => (base?.defaultSections ?? [emptySection]).map(draftSection));
  const create = useCreateDesignTemplate();
  const update = useUpdateDesignTemplate();
  const mutation = editing ? update : create;
  const save = () => {
    const fields = { name, description, focusPrompt, defaultSections: sections.map(({ section }) => section) };
    if (editing) update.mutate({ key: base.key, ...fields }, { onSuccess: onClose });
    else create.mutate({ baseKey: base?.key, ...fields }, { onSuccess: onClose });
  };
  const valid =
    name.trim() !== '' && focusPrompt.trim() !== '' && sections.every(({ section }) => section.title.trim() !== '');
  const patch = (key: string, section: Partial<DesignTemplateSection>) =>
    setSections((previous) =>
      previous.map((item) => (item.key !== key ? item : { ...item, section: { ...item.section, ...section } })),
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
      title={editing ? C.editTemplate : copy ? C.copyTemplate : C.newTemplate}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={onClose}>
            {C.cancel}
          </Button>
          <Button variant="primary" pending={mutation.isPending} disabled={!valid} onClick={save}>
            {C.save}
          </Button>
        </>
      }
    >
      <div className="col">
        <label className="field">
          <span className="label">{C.templateName}</span>
          <input
            className="input"
            value={name}
            maxLength={DESIGN_TITLE_MAX_CHARS}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">{C.templateDescription}</span>
          <textarea
            className="textarea"
            value={description}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">{C.templateFocus}</span>
          <textarea
            className="textarea"
            value={focusPrompt}
            rows={4}
            maxLength={DESIGN_INSTRUCTION_MAX_CHARS}
            onChange={(e) => setFocusPrompt(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="label">{C.chapterBlueprint}</span>
          {sections.map(({ key, section }) => (
            <div className={styles.templateFields} key={key}>
              <select
                className="select"
                aria-label={C.chapterType}
                value={section.kind}
                onChange={(e) => patch(key, { kind: designSectionKindSchema.parse(e.target.value) })}
              >
                {Object.values(DesignSectionKind).map((kind) => (
                  <option key={kind} value={kind}>
                    {DESIGN_SECTION_LABEL[kind]}
                  </option>
                ))}
              </select>
              <input
                className="input"
                aria-label={C.chapter}
                placeholder={C.chapter}
                value={section.title}
                maxLength={DESIGN_TITLE_MAX_CHARS}
                onChange={(e) => patch(key, { title: e.target.value })}
              />
              <input
                className="input"
                aria-label={C.scopeHint}
                placeholder={C.scopeHint}
                value={section.scopeHint}
                onChange={(e) => patch(key, { scopeHint: e.target.value })}
              />
              <Button
                size="sm"
                disabled={sections.length === 1}
                onClick={() => setSections((current) => current.filter((row) => row.key !== key))}
              >
                {C.removeChapter}
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              icon="plus"
              disabled={sections.length === DESIGN_MAX_SECTIONS}
              onClick={() => setSections((previous) => [...previous, draftSection(emptySection)])}
            >
              {C.newChapter}
            </Button>
          </div>
        </div>
        {mutation.isError && <ErrorState error={mutation.error} />}
      </div>
    </Dialog>
  );
}

export function TemplateLibrary({ projectId }: { projectId: string | undefined }) {
  const templates = useQuery(designTemplatesQuery());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<DesignTemplate | null>(null);
  const remove = useDeleteDesignTemplate();
  return (
    <div className="col">
      <div>
        <Button icon="plus" onClick={() => setEditor({ copy: false })}>
          {C.newTemplate}
        </Button>
      </div>
      {templates.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />}
      <div className={styles.grid}>
        {templates.data?.items.map((template) => {
          const builtin = template.kind === DesignTemplateKind.Builtin;
          return (
            <article className={`card pad col ${styles.templateCard}`} key={template.key}>
              <div className="row wrap">
                <strong className="grow">{template.name}</strong>
                <span className="badge">{builtin ? C.builtin : C.custom}</span>
              </div>
              {template.description && <p className="hint">{template.description}</p>}
              {template.matchHints.length > 0 && (
                <div className="hint">
                  {C.detection} · {template.matchHints.join('、')}
                </div>
              )}
              <div className="col">
                <strong>{C.chapterBlueprint}</strong>
                <p>{template.defaultSections.map((section) => section.title).join(' → ')}</p>
              </div>
              <details>
                <summary>{C.templateFocus}</summary>
                <p className={styles.focus}>{template.focusPrompt}</p>
              </details>
              <div className={`row wrap ${styles.templateActions}`}>
                <Link to={ROUTES.designNew} search={{ projectId, template: template.key }} className="btn primary sm">
                  {C.useTemplate}
                </Link>
                <Button size="sm" onClick={() => setEditor({ base: template, copy: true })}>
                  {C.copyTemplate}
                </Button>
                {!builtin && (
                  <>
                    <Button size="sm" onClick={() => setEditor({ base: template, copy: false })}>
                      {C.edit}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        remove.reset();
                        setDeleting(template);
                      }}
                    >
                      {C.delete}
                    </Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {editor !== null && <TemplateEditor editor={editor} onClose={() => setEditor(null)} />}
      {deleting !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(null);
          }}
          title={C.deleteTemplate}
          description={C.deleteTemplateNote(deleting.name)}
          footer={
            <>
              <Button disabled={remove.isPending} onClick={() => setDeleting(null)}>
                {C.cancel}
              </Button>
              <Button
                variant="danger"
                pending={remove.isPending}
                onClick={() => remove.mutate({ key: deleting.key }, { onSuccess: () => setDeleting(null) })}
              >
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
