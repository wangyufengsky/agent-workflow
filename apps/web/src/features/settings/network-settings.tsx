import { RuntimeStatus, type Settings } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { runtimeQuery, useRestartRuntime } from '../runtime/runtime.queries.ts';

/**
 * The offline environment (D168). It applies when opencode starts, so while the running one was started the other
 * way the panel offers to restart it now.
 */
export function NetworkSettings({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  const runtime = useQuery(runtimeQuery).data;
  const restart = useRestartRuntime();
  const offline = settings['network.offline'];
  const stale = runtime?.status === RuntimeStatus.Ready && runtime.offline !== offline;
  return (
    <Panel title={C.network}>
      <div className="row">
        <div className="grow col">
          <span className="label" id="offline-label">
            {C.offline}
          </span>
          <span className="hint">{C.offlineHint}</span>
        </div>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={offline}
          aria-labelledby="offline-label"
          onClick={() => set({ 'network.offline': !offline })}
        />
      </div>
      {stale && (
        <div className="row">
          <p className="hint grow">{C.offlineRestartHint}</p>
          <Button icon="refresh" pending={restart.isPending} onClick={() => restart.mutate()}>
            {C.restartNow}
          </Button>
        </div>
      )}
      {restart.isError && <ErrorState error={restart.error} />}
    </Panel>
  );
}
