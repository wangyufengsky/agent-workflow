import { type EnvironmentDTO, GIT_MIN_VERSION_TEXT, type Platform, RuntimeStatus, StatusTone } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ONBOARDING_COPY as C } from '../../copy/onboarding.ts';
import { AddProjectForm } from '../projects/add-project-form.tsx';
import { useUpdateSettings } from '../settings/settings.queries.ts';
import { CheckRow } from './check-row.tsx';
import { CopyCommand } from './copy-command.tsx';
import { CredentialsCheck } from './credentials-check.tsx';
import { environmentQuery, useRecheckEnvironment } from './environment.queries.ts';

function GitCheck({ git, platform }: { git: EnvironmentDTO['git']; platform: Platform }) {
  if (git.installed && !git.supported) {
    return (
      <CheckRow title={C.git.title} tone={StatusTone.Danger} badge={C.notReady}>
        <span className="hint">{C.git.tooOld(git.version, GIT_MIN_VERSION_TEXT)}</span>
      </CheckRow>
    );
  }
  if (git.installed) {
    return (
      <CheckRow title={C.git.title} tone={StatusTone.Ok} badge={C.ready}>
        <span className="hint">{C.git.installed(git.version)}</span>
      </CheckRow>
    );
  }
  return (
    <CheckRow title={C.git.title} tone={StatusTone.Danger} badge={C.notReady}>
      <span className="hint">{C.git.missing[platform]}</span>
      <CopyCommand command={C.git.fix[platform]} />
    </CheckRow>
  );
}

function OpencodeCheck({
  opencode,
  platform,
  onRecheck,
}: {
  opencode: EnvironmentDTO['opencode'];
  platform: Platform;
  onRecheck: () => void;
}) {
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
          placeholder={C.opencode.pathPlaceholder[platform]}
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
    const noContext = environment.models.available.filter((m) => m.contextLimit === null).length;
    return (
      <CheckRow title={C.models.title} tone={StatusTone.Ok} badge={C.ready}>
        <span className="hint">{C.models.available(count)}</span>
        {noContext > 0 && <span className="hint">{C.models.noContext(noContext)}</span>}
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

/**
 * The environment checks (14 §3.1) under a page head with「重新检测」; the first-run page adds the first project below
 * them once everything is ready.
 */
export function EnvironmentChecks({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children?: (environment: EnvironmentDTO) => ReactNode;
}) {
  const environment = useQuery(environmentQuery);
  const recheck = useRecheckEnvironment();
  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{title}</h1>
          <p className="lede">{lede}</p>
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
            <GitCheck git={environment.data.git} platform={environment.data.platform} />
            <OpencodeCheck
              opencode={environment.data.opencode}
              platform={environment.data.platform}
              onRecheck={() => recheck.mutate()}
            />
            <ModelsCheck environment={environment.data} />
            <CredentialsCheck environment={environment.data} />
          </div>
          {children?.(environment.data)}
        </>
      )}
    </div>
  );
}

/** First-run checks, then the first project (14 §3.1); outside the shell, shown only while there is no project. */
export function OnboardingPage() {
  const navigate = useNavigate();
  return (
    <div className="content">
      <EnvironmentChecks title={C.title} lede={C.lede}>
        {(environment) => (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">{C.addFirstProject}</h2>
            </div>
            <p className="hint">{C.addFirstProjectHint}</p>
            <div className="divider" />
            {environment.ready ? (
              <AddProjectForm onAdded={() => void navigate({ to: ROUTES.home })} />
            ) : (
              <div className="banner warn">{C.envNotReady}</div>
            )}
          </section>
        )}
      </EnvironmentChecks>
    </div>
  );
}

/** The same checks inside the shell (14 §3.1a): where the sidebar's runtime chip leads in simple mode. */
export function EnvironmentPage() {
  return <EnvironmentChecks title={C.environmentTitle} lede={C.environmentLede} />;
}
