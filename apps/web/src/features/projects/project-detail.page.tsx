import { type ProjectDetailDTO, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Panel } from '../../components/panel.tsx';
import { toast } from '../../components/toast.tsx';
import { PREVIEW_COPY } from '../../copy/browser.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { DATABASES_COPY } from '../../copy/databases.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { AGENTS_MD_COPY, PROJECTS_COPY as C } from '../../copy/projects.ts';
import { ProjectDatabases } from '../databases/project-databases.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { HostingPanel } from './hosting-form.tsx';
import { ProjectAgentsMd } from './project-agents-md.tsx';
import { ProjectAllowedBash } from './project-allowed-bash.tsx';
import { ProjectPreviewForm } from './project-preview.tsx';
import { projectQuery, useDeleteProject, useUpdateProject } from './projects.queries.ts';

const route = getRouteApi(ROUTE_IDS.project);

function ProjectForm({ project }: { project: ProjectDetailDTO }) {
  const [name, setName] = useState(project.name);
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch);
  const [checkCommand, setCheckCommand] = useState(project.checkCommand ?? '');
  const update = useUpdateProject();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const command = checkCommand.trim();
    // Saving remounts this form (keyed by the project's update time): per-call callbacks of a mutation whose
    // component unmounted never run, so the toast follows the promise. A failure shows through the mutation's state.
    update
      .mutateAsync({
        id: project.id,
        name: name.trim(),
        defaultBranch: defaultBranch.trim(),
        checkCommand: command === '' ? null : command,
      })
      .then(
        () => toast(C.saved),
        () => undefined,
      );
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="project-name">
          {C.name}
        </label>
        <input id="project-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="project-branch">
          {C.defaultBranch}
        </label>
        <input
          id="project-branch"
          className="input mono"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="project-check">
          {C.checkCommand}
        </label>
        <input
          id="project-check"
          className="input mono"
          value={checkCommand}
          onChange={(e) => setCheckCommand(e.target.value)}
        />
        <p className="hint">{C.checkCommandHint}</p>
      </div>
      {update.isError && <ErrorState error={update.error} />}
      <div className="divider" />
      <Button type="submit" variant="primary" pending={update.isPending} disabled={name.trim() === ''}>
        {C.save}
      </Button>
    </form>
  );
}

export function ProjectDetailPage() {
  const { projectId } = route.useParams();
  const project = useQuery(projectQuery(projectId));
  const remove = useDeleteProject();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const pro = useSettings()['ui.mode'] === UiMode.Pro;

  if (project.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (project.isError) {
    return (
      <div className="page">
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  const p = project.data;
  return (
    <div className="page narrow">
      <div className="crumbs">
        <Link to={ROUTES.projects}>{C.back}</Link>
        <span className="sep">/</span>
        <span className="cur">{p.name}</span>
      </div>
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{p.name}</h1>
          <p className="lede mono">{p.repoPath}</p>
        </div>
        <Link to={ROUTES.pptNew} search={{ projectId: p.id }} className="btn sm">
          <Icon name="slides" size="sm" />
          {PPT_COPY.makeDeck}
        </Link>
      </div>
      <Panel title={C.title}>
        {/* Keyed by the saved values so the form resets when the project changes underneath it. */}
        <ProjectForm key={`${p.id}:${p.updatedAt}`} project={p} />
      </Panel>
      <section className="section">
        <Panel title={AGENTS_MD_COPY.section}>
          <ProjectAgentsMd projectId={p.id} />
        </Panel>
      </section>
      <section className="section">
        <Panel title={PREVIEW_COPY.section}>
          <ProjectPreviewForm key={`${p.id}:${p.updatedAt}`} project={p} />
        </Panel>
      </section>
      <section className="section">
        <Panel title={C.remote}>
          <HostingPanel key={`${p.id}:${p.updatedAt}`} project={p} />
        </Panel>
      </section>
      {pro && (
        <section className="section">
          <Panel title={DATABASES_COPY.projectSection}>
            <ProjectDatabases key={`${p.id}:${p.dbConnectionIds.join(',')}`} project={p} />
          </Panel>
        </section>
      )}
      {pro && (
        <section className="section">
          <Panel title={C.allowedBash}>
            <ProjectAllowedBash project={p} />
          </Panel>
        </section>
      )}
      <section className="section">
        <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
          {C.delete}
        </Button>
      </section>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={C.deleteTitle}
        description={C.deleteBody}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {COMMON_COPY.cancel}
            </Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() =>
                remove.mutate(p.id, {
                  onSuccess: () => {
                    toast(C.deleted);
                    void navigate({ to: ROUTES.projects, search: {} });
                  },
                })
              }
            >
              {C.delete}
            </Button>
          </>
        }
      />
    </div>
  );
}
