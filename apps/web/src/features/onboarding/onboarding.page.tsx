import { type EnvironmentDTO, RuntimeStatus, StatusTone } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ONBOARDING_COPY as C } from '../../copy/onboarding.ts';
import { AddProjectForm } from '../projects/add-project-form.tsx';
import { useUpdateSettings } from '../settings/settings.queries.ts';
import { CheckRow } from './check-row.tsx';
import { CopyCommand } from './copy-command.tsx';
import { environmentQuery, useRecheckEnvironment } from './environment.queries.ts';

function GitCheck({ git }: { git: EnvironmentDTO['git'] }) {
  if (git.installed) {
    return (
      <CheckRow title={C.git.title} tone={StatusTone.Ok} badge={C.ready}>
        <span className="hint">{C.git.installed(git.version)}</span>
      </CheckRow>
    );
  }
  return (
    <CheckRow title={C.git.title} tone={StatusTone.Danger} badge={C.notReady}>
      <span className="hint">{C.git.missing}</span>
      <CopyCommand command={C.git.fix} />
    </CheckRow>
  );
}

function OpencodeCheck({ opencode, onRecheck }: { opencode: EnvironmentDTO['opencode']; onRecheck: () => void }) {
  const [path, setPath] = useState('');
  const update = useUpdateSettings();
  if (opencode.status !== RuntimeStatus.NotInstalled && opencode.status !== RuntimeStatus.VersionMismatch) {
    return (
      <CheckRow title={C.opencode.title} tone={StatusTone.Ok} badge={C.ready}>
        <span className="hint">{C.opencode.ok(opencode.version, opencode.path)}</span>
      </CheckRow>
    );
  }
  return (
    <CheckRow title={C.opencode.title} tone={StatusTone.Danger} badge={C.notReady}>
      <span className="hint">
        {opencode.status === RuntimeStatus.VersionMismatch ? C.opencode.mismatch(opencode.version) : C.opencode.missing}
      </span>
      <CopyCommand command={C.opencode.fix} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ 'opencode.binaryPath': path.trim() }, { onSuccess: onRecheck });
        }}
      >
        <label className="hint" htmlFor="opencode-path">
          {C.opencode.choosePath}
        </label>
        <input
          id="opencode-path"
          className="input ctl mono grow"
          placeholder={C.opencode.pathPlaceholder}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={path.trim() === ''} pending={update.isPending}>
          {C.opencode.usePath}
        </Button>
      </form>
    </CheckRow>
  );
}

/** Models are listed by the running opencode; before it runs they are unknown, not missing. */
function ModelsCheck({ environment }: { environment: EnvironmentDTO }) {
  const count = environment.models.available.length;
  if (count > 0) {
    return (
      <CheckRow title={C.models.title} tone={StatusTone.Ok} badge={C.ready}>
        <span className="hint">{C.models.available(count)}</span>
      </CheckRow>
    );
  }
  if (environment.opencode.status === RuntimeStatus.Ready) {
    return (
      <CheckRow title={C.models.title} tone={StatusTone.Danger} badge={C.notReady}>
        <span className="hint">{C.models.none}</span>
        <CopyCommand command={C.models.fix} />
      </CheckRow>
    );
  }
  return (
    <CheckRow title={C.models.title} tone={StatusTone.Wait} badge={C.models.pendingBadge}>
      <span className="hint">{C.models.pending}</span>
      <CopyCommand command={C.models.fix} />
    </CheckRow>
  );
}

/** First-run checks, then the first project (14 §3.1). */
export function OnboardingPage() {
  const environment = useQuery(environmentQuery);
  const recheck = useRecheckEnvironment();
  const navigate = useNavigate();

  return (
    <div className="content">
      <div className="page narrow">
        <div className="page-head">
          <div className="grow">
            <h1 className="title">{C.title}</h1>
            <p className="lede">{C.lede}</p>
          </div>
          <Button icon="refresh" pending={recheck.isPending} onClick={() => recheck.mutate()}>
            {C.recheck}
          </Button>
        </div>
        {environment.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {environment.isError && <ErrorState error={environment.error} onRetry={() => void environment.refetch()} />}
        {environment.data !== undefined && (
          <>
            <div className="card list list-sep">
              <GitCheck git={environment.data.git} />
              <OpencodeCheck opencode={environment.data.opencode} onRecheck={() => recheck.mutate()} />
              <ModelsCheck environment={environment.data} />
            </div>
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">{C.addFirstProject}</h2>
              </div>
              <p className="hint">{C.addFirstProjectHint}</p>
              <div className="divider" />
              {environment.data.ready ? (
                <AddProjectForm onAdded={() => void navigate({ to: ROUTES.home })} />
              ) : (
                <div className="banner warn">{C.envNotReady}</div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
