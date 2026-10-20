import { RUNTIME_LOG_TAIL_DEFAULT, RuntimeStatus, STATUS_TONE } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { RUNTIME_COPY as C, RUNTIME_STATUS_LABEL } from '../../copy/runtime.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import { CopyCommand } from '../onboarding/copy-command.tsx';
import { environmentQuery } from '../onboarding/environment.queries.ts';
import { DebugAttemptForm } from './debug-attempt-form.tsx';
import styles from './runtime.module.css';
import { runtimeLogsQuery, runtimeQuery, useRestartRuntime } from './runtime.queries.ts';

/** Line counts offered for the log tail. */
const LOG_TAILS = [200, 500, 2000] as const;

function LogsPanel() {
  const [tail, setTail] = useState<number>(RUNTIME_LOG_TAIL_DEFAULT);
  const logs = useQuery(runtimeLogsQuery(tail));
  return (
    <Panel
      title={C.logs}
      actions={
        <span className="row">
          <label className="hint" htmlFor="log-tail">
            {C.logsTail}
          </label>
          <select id="log-tail" className="select" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {LOG_TAILS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button size="sm" icon="refresh" pending={logs.isFetching} onClick={() => void logs.refetch()}>
            {C.logsRefresh}
          </Button>
        </span>
      }
    >
      {logs.isError && <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />}
      {logs.data?.file === null && <p className="hint">{C.logsEmpty}</p>}
      {logs.data !== undefined && logs.data.file !== null && (
        <div className="col">
          <span className="hint mono">{C.logsFile(logs.data.file)}</span>
          <pre className={styles.logs} data-testid="runtime-logs">
            {logs.data.lines.join('\n')}
          </pre>
        </div>
      )}
    </Panel>
  );
}

const route = getRouteApi(ROUTE_IDS.runtime);

const formatTime = (ms: number) => new Date(ms).toLocaleString();

function RuntimePanel() {
  const runtime = useQuery(runtimeQuery);
  const restart = useRestartRuntime();
  if (runtime.isPending) return <p className="hint">{COMMON_COPY.loading}</p>;
  if (runtime.isError) return <ErrorState error={runtime.error} onRetry={() => void runtime.refetch()} />;
  const r = runtime.data;
  const hostable = r.status !== RuntimeStatus.NotInstalled && r.status !== RuntimeStatus.VersionMismatch;
  const canRestart =
    r.status === RuntimeStatus.Ready || r.status === RuntimeStatus.Crashed || r.status === RuntimeStatus.Stopped;
  return (
    <Panel
      title={C.opencode}
      actions={<StatusBadge tone={STATUS_TONE.runtime[r.status]} label={RUNTIME_STATUS_LABEL[r.status]} />}
      footer={
        hostable ? (
          <span className="row">
            <Button icon="refresh" pending={restart.isPending} disabled={!canRestart} onClick={() => restart.mutate()}>
              {r.status === RuntimeStatus.Ready ? C.restart : C.start}
            </Button>
            <span className="hint">{C.restartHint}</span>
          </span>
        ) : (
          <span className="row">
            <span className="hint">{C.notHostable}</span>
            <Link to={ROUTES.onboarding}>{C.openOnboarding}</Link>
          </span>
        )
      }
    >
      <dl className="kv" data-testid="runtime-details">
        {r.status !== RuntimeStatus.NotInstalled && (
          <>
            <dt>{C.version}</dt>
            <dd className="mono">{r.version}</dd>
          </>
        )}
        <dt>{C.requiredVersion}</dt>
        <dd className="mono">{r.requiredVersion}</dd>
        {r.path !== undefined && (
          <>
            <dt>{C.path}</dt>
            <dd className="mono">{r.path}</dd>
          </>
        )}
        {r.status === RuntimeStatus.Ready && (
          <>
            <dt>{C.url}</dt>
            <dd className="mono">{r.url}</dd>
            <dt>{C.startedAt}</dt>
            <dd>{formatTime(r.startedAt)}</dd>
          </>
        )}
      </dl>
      {restart.isError && <ErrorState error={restart.error} />}
    </Panel>
  );
}

function ModelsPanel() {
  const environment = useQuery(environmentQuery);
  if (environment.data === undefined) return null;
  const { models, opencode } = environment.data;
  return (
    <Panel title={C.models}>
      {models.available.length > 0 ? (
        <p className="hint">
          {C.modelsCount(models.available.length)}
          {models.defaultModel === undefined ? null : ` · ${C.defaultModel(models.defaultModel)}`}
        </p>
      ) : opencode.status === RuntimeStatus.Ready ? (
        <>
          <p className="hint">{C.noModels}</p>
          <CopyCommand command="opencode auth login" />
        </>
      ) : (
        <p className="hint">{C.modelsPending}</p>
      )}
    </Panel>
  );
}

/** Runtime page (pro mode, 14 §1): the hosted opencode, its models and, in development builds, the debug entry. */
export function RuntimePage() {
  const { attempt } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <div className="page narrow">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      <div className="stack">
        <RuntimePanel />
        <ModelsPanel />
        <LogsPanel />
        {import.meta.env.DEV && (
          <>
            <DebugAttemptForm onStarted={(id) => void navigate({ search: { attempt: id } })} />
            {attempt !== undefined && <AttemptView key={attempt} attemptId={attempt} />}
          </>
        )}
      </div>
    </div>
  );
}
