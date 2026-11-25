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
  const [order, setOrder] = useState<'builtin' | 'name'>('builtin');
  const items = (templates.data?.items ?? []).toSorted(
    (a, b) => (order === 'builtin' ? a.kind.localeCompare(b.kind) : 0) || a.name.localeCompare(b.name, 'zh-CN'),
  );
  return (
    <div className="col">
      <div className="row wrap">
        <label className={`row ${styles.templateOrder}`}>
          <span className="hint">{C.templateOrder}</span>
          <select
            className="select"
            value={order}
            onChange={(event) => setOrder(event.currentTarget.value === 'name' ? 'name' : 'builtin')}
          >
            <option value="builtin">{C.builtinFirst}</option>
            <option value="name">{C.nameOrder}</option>
          </select>
        </label>
        <span className="grow" />
        <Button icon="plus" onClick={() => setEditor({ copy: false })}>
          {C.newTemplate}
        </Button>
      </div>
      {templates.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />}
      {items.length > 0 && (
        <div>
          <div className={`${styles.templateRow} ${styles.templateHead}`} aria-hidden="true">
            <span>{C.template}</span>
            <span>{C.chapterPreview}</span>
            <span>{C.templateFocus}</span>
            <span />
          </div>
          {items.map((template) => {
            const builtin = template.kind === DesignTemplateKind.Builtin;
            return (
              <article className={styles.templateRow} key={template.key}>
                <div className={styles.templateIdentity}>
                  <h3>{template.name}</h3>
                  <span className="hint">{builtin ? C.builtin : C.custom}</span>
                  {template.description && <p className="hint">{template.description}</p>}
                </div>
                <div>
                  <h4 className={styles.narrowTemplateLabel}>{C.chapterPreview}</h4>
                  <ul className={styles.templateChapters}>
                    {template.defaultSections.map((section, position) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview entries may share a label, and their index is their order.
                      <li key={position}>{section.title}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className={styles.narrowTemplateLabel}>{C.templateFocus}</h4>
                  <details className={styles.templateFocus}>
                    <summary>{C.expandFocus}</summary>
                    <p className={styles.focus}>{template.focusPrompt}</p>
                  </details>
                </div>
                <div className={styles.templateActions}>
                  <Link to={ROUTES.designNew} search={{ projectId, template: template.key }} className="btn sm">
                    {C.useTemplate}
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => setEditor({ base: template, copy: true })}>
                    {C.copyTemplate}
                  </Button>
                  {!builtin && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditor({ base: template, copy: false })}>
                        {C.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
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
      )}
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
