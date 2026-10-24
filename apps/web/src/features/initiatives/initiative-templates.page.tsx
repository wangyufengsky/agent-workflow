import { type InitiativeTemplateDTO, InitiativeTemplateKind } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INITIATIVE_TEMPLATES_COPY as C, INITIATIVE_TEMPLATE_KIND_LABEL } from '../../copy/initiatives.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { initiativeTemplatesQuery, useDeleteInitiativeTemplate } from './initiatives.queries.ts';
import { templateChain } from './use-start-initiative.ts';

function DeleteTemplateDialog({ template, onClose }: { template: InitiativeTemplateDTO; onClose: () => void }) {
  const remove = useDeleteInitiativeTemplate();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.deleteTitle(template.name)}
      footer={
        <Button
          variant="danger"
          pending={remove.isPending}
          onClick={() =>
            remove.mutate(template.key, {
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

/** Composition templates (34 §15.6, pro mode): built-in ones to copy, custom ones to edit or delete. */
export function InitiativeTemplatesPage() {
  const templates = useQuery(initiativeTemplatesQuery);
  const workflows = useQuery(workflowsQuery);
  const [deleting, setDeleting] = useState<InitiativeTemplateDTO | undefined>(undefined);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <Link to={ROUTES.workflows} className="crumbs">
            {C.backToWorkflows}
          </Link>
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Link to={ROUTES.initiativeTemplateNew} className="btn primary">
          <Icon name="plus" />
          {C.create}
        </Link>
      </div>
      {templates.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />}
      <div className="grid-2">
        {templates.data?.map((t) => (
          <article key={t.key} className="card pad col" data-testid={`template-${t.key}`} aria-label={t.name}>
            <span className="row">
              <span className="tile">
                <Icon name="split" />
              </span>
              <span className="section-title grow ellipsis">{t.name}</span>
              <span className="chip">{INITIATIVE_TEMPLATE_KIND_LABEL[t.kind]}</span>
            </span>
            <span className="hint">{t.description}</span>
            <span className="hint">{templateChain(t, workflows.data ?? [])}</span>
            <div className="row wrap">
              {t.kind === InitiativeTemplateKind.Custom && (
                <Link to={ROUTES.initiativeTemplate} params={{ key: t.key }} className="btn secondary sm">
                  {C.edit}
                </Link>
              )}
              <Link to={ROUTES.initiativeTemplateNew} search={{ copy: t.key }} className="btn ghost sm">
                <Icon name="copy" />
                {C.copy}
              </Link>
              {t.kind === InitiativeTemplateKind.Custom && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(t)}>
                  {C.delete}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {deleting !== undefined && <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
