import { MCP_TOOL_PREFIX } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { ATTEMPT_KIND_LABEL } from '../../copy/attempts.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { TOOLS_COPY as C } from '../../copy/runtime.ts';
import { mcpToolsQuery } from '../runtime/runtime.queries.ts';
import styles from './tools.module.css';

/** MCP tools page (M5-08, 14 §1): what the execution MCP offers AI sessions (11 §10 `/mcp/tools`). */
export function ToolsPage() {
  const tools = useQuery(mcpToolsQuery);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {tools.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {tools.isError && <ErrorState error={tools.error} onRetry={() => void tools.refetch()} />}
      <div className="col">
        {tools.data?.map((tool) => (
          <article key={tool.name} className="card pad col" aria-label={tool.name}>
            <span className="row">
              <span className="section-title mono grow">{tool.name}</span>
              <span className="hint mono">{`${MCP_TOOL_PREFIX}${tool.name}`}</span>
            </span>
            <p className="sub">{tool.description}</p>
            <span className="row wrap">
              <span className="hint">{C.allowedKinds}</span>
              {tool.allowedKinds.map((kind) => (
                <span key={kind} className="chip">
                  {ATTEMPT_KIND_LABEL[kind]}
                </span>
              ))}
            </span>
            <details>
              <summary className="hint">{C.inputSchema}</summary>
              <pre className={styles.schema}>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
