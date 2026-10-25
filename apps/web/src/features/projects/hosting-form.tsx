import {
  AssistantForm,
  HostingProvider,
  HostingSource,
  hostingProviderSchema,
  type ProjectDetailDTO,
} from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { PROJECTS_COPY as C } from '../../copy/projects.ts';
import { clearPendingForm, usePendingForm } from '../../state/ui.store.ts';
import { useClearHosting, useSetHosting } from './projects.queries.ts';

type Prefill = { provider?: HostingProvider; baseUrl?: string; repo?: string };

/** What the assistant's `open_form` prefills (15 §5); never the token. */
function prefillOf(values: Record<string, unknown>): Prefill {
  const provider = hostingProviderSchema.safeParse(values.provider);
  return {
    ...(provider.success ? { provider: provider.data } : {}),
    ...(typeof values.baseUrl === 'string' ? { baseUrl: values.baseUrl } : {}),
    ...(typeof values.repo === 'string' ? { repo: values.repo } : {}),
  };
}

/**
 * Binding the project to its GitHub / GitLab repository with a token (14 §3.7); prefilled from origin, or from the
 * assistant's `open_form`. The user types the token.
 */
function BindForm({ project, prefill, onDone }: { project: ProjectDetailDTO; prefill: Prefill; onDone: () => void }) {
  const known = project.hosting ?? project.inferredHosting;
  const [provider, setProvider] = useState<HostingProvider>(
    prefill.provider ?? known?.provider ?? HostingProvider.Github,
  );
  const [baseUrl, setBaseUrl] = useState(prefill.baseUrl ?? known?.baseUrl ?? '');
  const [repo, setRepo] = useState(prefill.repo ?? known?.repo ?? '');
  const [token, setToken] = useState('');
  const bind = useSetHosting();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Binding remounts the panel (keyed by the project's update time), which drops per-call callbacks of the
    // mutation: what follows the save hangs on the promise. A failure shows through the mutation's state.
    bind
      .mutateAsync({
        id: project.id,
        provider,
        ...(provider === HostingProvider.Gitlab && baseUrl.trim() !== '' ? { baseUrl: baseUrl.trim() } : {}),
        repo: repo.trim(),
        token: token.trim(),
      })
      .then(
        () => {
          toast(C.hostingSaved);
          onDone();
        },
        () => undefined,
      );
  };
  return (
    <form onSubmit={submit} aria-label={C.remote}>
      <div className="field">
        <label className="label" htmlFor="hosting-provider">
          {C.hostingProvider}
        </label>
        <select
          id="hosting-provider"
          className="select"
          value={provider}
          onChange={(e) => setProvider(hostingProviderSchema.parse(e.target.value))}
        >
          {Object.values(HostingProvider).map((p) => (
            <option key={p} value={p}>
              {C.providers[p]}
            </option>
          ))}
        </select>
      </div>
      {provider === HostingProvider.Gitlab && (
        <div className="field">
          <label className="label" htmlFor="hosting-base-url">
            {C.hostingBaseUrl}
          </label>
          <input
            id="hosting-base-url"
            className="input mono"
            placeholder="https://gitlab.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="hint">{C.hostingBaseUrlHint}</p>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="hosting-repo">
          {C.hostingRepo}
        </label>
        <input
          id="hosting-repo"
          className="input mono"
          placeholder="owner/name"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="hosting-token">
          {C.hostingToken}
        </label>
        <input
          id="hosting-token"
          className="input mono"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="hint">{C.hostingTokenHint}</p>
      </div>
      {bind.isError && <ErrorState error={bind.error} />}
      <Button
        type="submit"
        variant="primary"
        pending={bind.isPending}
        disabled={repo.trim() === '' || token.trim() === ''}
      >
        {C.hostingSave}
      </Button>
    </form>
  );
}

export function HostingPanel({ project }: { project: ProjectDetailDTO }) {
  const [editing, setEditing] = useState(false);
  const clear = useClearHosting();
  const pending = usePendingForm(AssistantForm.ProjectHosting);
  const prefill = pending?.values.id === project.id ? pending : undefined;
  const { hosting } = project;
  const done = () => {
    clearPendingForm();
    setEditing(false);
  };
  if (hosting === null || editing || prefill !== undefined) {
    return (
      <div className="col">
        <p className="hint">
          {project.effectiveHosting?.source === HostingSource.Global
            ? C.remoteGlobal(C.providers[project.effectiveHosting.provider], project.effectiveHosting.repo)
            : project.inferredHosting === null
              ? C.remoteNone
              : C.remoteInferred(C.providers[project.inferredHosting.provider], project.inferredHosting.repo)}
        </p>
        <BindForm
          key={prefill?.seq}
          project={project}
          prefill={prefill === undefined ? {} : prefillOf(prefill.values)}
          onDone={done}
        />
      </div>
    );
  }
  return (
    <div className="col">
      <p data-testid="hosting-bound">{C.hostingBound(C.providers[hosting.provider], hosting.repo, hosting.baseUrl)}</p>
      <div className="row">
        <Button onClick={() => setEditing(true)}>{C.hostingChange}</Button>
        <Button
          variant="ghost"
          pending={clear.isPending}
          onClick={() =>
            clear.mutateAsync(project.id).then(
              () => toast(C.hostingCleared),
              () => undefined,
            )
          }
        >
          {C.hostingClear}
        </Button>
      </div>
      {clear.isError && <ErrorState error={clear.error} />}
    </div>
  );
}
