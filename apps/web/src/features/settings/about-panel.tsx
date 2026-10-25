import { APP_LICENSE, APP_SOURCE_URL, OPENCODE_SUPPORTED_RANGE, OPENCODE_VERSION } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { Panel } from '../../components/panel.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { healthQuery } from '../runtime/runtime.queries.ts';

/** About (M6-04): which version this is and what it hosts. */
export function AboutPanel() {
  const health = useQuery(healthQuery);
  return (
    <Panel title={C.about}>
      {health.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {health.isError && <ErrorState error={health.error} onRetry={() => void health.refetch()} />}
      {health.data !== undefined && (
        <dl className="kv" data-testid="about">
          <dt>{C.version}</dt>
          <dd className="mono">{health.data.appVersion}</dd>
          <dt>{C.opencodeVersion}</dt>
          <dd className="mono">{C.opencodeVersions(OPENCODE_SUPPORTED_RANGE, OPENCODE_VERSION)}</dd>
          <dt>{C.nodeVersion}</dt>
          <dd className="mono">{health.data.node}</dd>
          <dt>{C.license}</dt>
          <dd>{APP_LICENSE}</dd>
          <dt>{C.source}</dt>
          <dd>
            <ExternalLink href={APP_SOURCE_URL}>{APP_SOURCE_URL}</ExternalLink>
          </dd>
        </dl>
      )}
    </Panel>
  );
}
