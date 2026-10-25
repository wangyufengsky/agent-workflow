import { listExternalMcpOp, OPENCODE_MCP_DOCS_URL, STATUS_TONE } from '@aw/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { ASSISTANT_SETTINGS_COPY as C } from '../../copy/assistant.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import styles from './external-mcp.module.css';

/** Read again when the runtime changes (server-events.ts): opencode connects them when it starts. */
const externalMcpQuery = queryOptions({
  queryKey: queryKeys.externalMcp,
  queryFn: async () => (await callOperation(listExternalMcpOp, {})).items,
});

/** The MCP servers the user added to opencode themself, which the assistant can use (28 §4), and how to add one. */
export function ExternalMcp() {
  const servers = useQuery(externalMcpQuery);
  return (
    <div className="field">
      <span className="label">{C.externalMcp}</span>
      <p className="hint">{C.externalMcpHint}</p>
      {servers.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {servers.isError && <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />}
      {servers.data !== undefined &&
        (servers.data.length === 0 ? (
          <p className="hint">{C.externalMcpNone}</p>
        ) : (
          <ul className={`col ${styles.list}`} aria-label={C.externalMcp}>
            {servers.data.map((server) => (
              <li key={server.name} className="col">
                <span className="row">
                  <span className="grow mono">{server.name}</span>
                  <StatusBadge
                    tone={STATUS_TONE.externalMcp[server.status]}
                    label={C.externalMcpStatus[server.status]}
                  />
                </span>
                {server.error !== null && <span className="hint">{server.error}</span>}
              </li>
            ))}
          </ul>
        ))}
      <p className="hint">
        {C.externalMcpHowTo}{' '}
        <ExternalLink href={OPENCODE_MCP_DOCS_URL}>
          <span className="link">{C.externalMcpDocs}</span>
        </ExternalLink>
      </p>
    </div>
  );
}
