import {
  DEFINITION_KEY_PATTERN,
  INITIATIVE_TEMPLATE_PLACEHOLDER,
  type InitiativeDraft,
  InitiativeTemplateKind,
  type SaveInitiativeTemplateRequest,
  validateInitiativeDraft,
  WorkflowKind,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INITIATIVE_TEMPLATES_COPY as C, INITIATIVE_PROBLEM_LABEL } from '../../copy/initiatives.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { DraftFields, toDraft } from './draft-editor.tsx';
import styles from './initiatives.module.css';
import {
  initiativeQuery,
  initiativeTemplatesQuery,
  useCreateInitiativeTemplate,
  useUpdateInitiativeTemplate,
} from './initiatives.queries.ts';

type Meta = Pick<SaveInitiativeTemplateRequest, 'key' | 'name' | 'description'>;

/**
 * One custom template's name and phases (34 §15.6). Its problems are checked here as the server will
 * (`validateInitiativeDraft` with `template`), so the user sees what is missing, `{{requirement}}` above all.
 */
function TemplateEditor({
  initial,
  draft: initialDraft,
  isNew,
  note,
}: {
  initial: Meta;
  draft: InitiativeDraft;
  isNew: boolean;
  note?: string;
}) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(initial);
  const [draft, setDraft] = useState(initialDraft);
  const workflows = useQuery(workflowsQuery).data ?? [];
  const create = useCreateInitiativeTemplate();
  const update = useUpdateInitiativeTemplate();
  const save = isNew ? create : update;
  const workflowExists = (key: string) => workflows.some((w) => w.key === key && w.kind !== WorkflowKind.System);
  const problems = [
    ...(DEFINITION_KEY_PATTERN.test(meta.key) ? [] : [C.keyProblem]),
    ...(meta.name.trim() === '' || meta.description.trim() === '' ? [C.nameRequired] : []),
    ...validateInitiativeDraft(draft, { workflowExists, template: true }).map((p) =>
      p.itemKey === undefined
        ? INITIATIVE_PROBLEM_LABEL[p.code]
        : `${INITIATIVE_PROBLEM_LABEL[p.code]}（${p.itemKey}）`,
    ),
  ];
  const submit = () =>
    save.mutate(
      { ...meta, name: meta.name.trim(), description: meta.description.trim(), ...draft },
      {
        onSuccess: () => {
          toast(C.saved);
          void navigate({ to: ROUTES.initiativeTemplates });
        },
      },
    );
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <Link to={ROUTES.initiativeTemplates} className="crumbs">
            {C.back}
          </Link>
          <h1 className="title">{isNew ? C.newTitle : C.editTitle(initial.name)}</h1>
          <p className="lede">{C.placeholderHint}</p>
        </div>
      </div>
      {note !== undefined && <div className="banner">{note}</div>}
      <section className="card pad col" data-testid="template-editor">
        <div className={styles.metaGrid}>
          <label className="col">
            <span className="hint">{C.key}</span>
            <input
              className="input mono"
              value={meta.key}
              readOnly={!isNew}
              onChange={(e) => setMeta({ ...meta, key: e.target.value })}
            />
          </label>
          <label className="col">
            <span className="hint">{C.name}</span>
            <input
              className="input"
              maxLength={40}
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
            />
          </label>
          <label className={`col ${styles.wide}`}>
            <span className="hint">{C.description}</span>
            <input
              className="input"
              maxLength={200}
              value={meta.description}
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            />
          </label>
        </div>
        <DraftFields
          draft={draft}
          setDraft={setDraft}
          actions={
            <Button variant="primary" pending={save.isPending} disabled={problems.length > 0} onClick={submit}>
              {COMMON_COPY.save}
            </Button>
          }
        />
        {problems.length === 0 ? (
          <p className="hint">{C.noProblems}</p>
        ) : (
          <ul className={styles.problems} data-testid="template-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {save.isError && <ErrorState error={save.error} />}
      </section>
    </div>
  );
}

const editRoute = getRouteApi(ROUTE_IDS.initiativeTemplate);
const newRoute = getRouteApi(ROUTE_IDS.initiativeTemplateNew);

/** `/initiative-templates/:key`: a custom template, changed in place. */
export function InitiativeTemplateEditorPage() {
  const { key } = editRoute.useParams();
  const templates = useQuery(initiativeTemplatesQuery);
  const template = templates.data?.find((t) => t.key === key && t.kind === InitiativeTemplateKind.Custom);
  if (templates.isError) return <ErrorState error={templates.error} />;
  if (templates.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (template === undefined) return <EmptyState icon="split" title={C.notFound} />;
  const { phases, items, ...meta } = template;
  return <TemplateEditor key={key} initial={meta} draft={{ phases, items }} isNew={false} />;
}

const BLANK: InitiativeDraft = {
  phases: [{ title: '', goal: '', autoOpen: false }],
  items: [
    {
      key: 'item_1',
      title: '',
      phase: 1,
      workflow: 'feature',
      requirement: INITIATIVE_TEMPLATE_PLACEHOLDER,
      dependsOn: [],
      acceptance: [],
    },
  ],
};

/**
 * `/initiative-templates/new`: blank, a copy of a template (`?copy=`), or「存为模板」from an initiative
 * (`?initiative=`), whose requirements the user turns back into `{{requirement}}`.
 */
export function NewInitiativeTemplatePage() {
  const { copy, initiative: initiativeId } = newRoute.useSearch();
  const templates = useQuery({ ...initiativeTemplatesQuery, enabled: copy !== undefined });
  const initiative = useQuery({ ...initiativeQuery(initiativeId ?? ''), enabled: initiativeId !== undefined });
  const error = templates.error ?? initiative.error;
  if (error !== null) return <ErrorState error={error} />;
  if (copy !== undefined) {
    if (templates.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
    const source = templates.data.find((t) => t.key === copy);
    if (source === undefined) return <EmptyState icon="split" title={C.notFound} />;
    const meta = { key: '', name: C.copyName(source.name), description: source.description };
    return <TemplateEditor initial={meta} draft={{ phases: source.phases, items: source.items }} isNew />;
  }
  if (initiativeId !== undefined) {
    if (initiative.data === undefined) return <p className="hint">{COMMON_COPY.loading}</p>;
    const meta = { key: '', name: initiative.data.title.slice(0, 40), description: '' };
    return (
      <TemplateEditor
        initial={meta}
        draft={toDraft(initiative.data)}
        isNew
        note={C.fromInitiative(initiative.data.key)}
      />
    );
  }
  return <TemplateEditor initial={{ key: '', name: '', description: '' }} draft={BLANK} isNew />;
}
