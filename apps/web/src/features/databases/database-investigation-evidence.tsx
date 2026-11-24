import {
  type DatabaseInvestigation,
  databaseInvestigationSchema,
  MCP_ASSISTANT_TOOL_PREFIX,
  MCP_TOOL_PREFIX,
  McpToolName,
} from '@aw/shared';
import { DATABASE_INVESTIGATION_COPY as C } from '../../copy/databases.ts';
import styles from './database-investigation-evidence.module.css';

export const isDatabaseInvestigationTool = (tool: string) =>
  tool === `${MCP_TOOL_PREFIX}${McpToolName.InvestigateDatabase}` ||
  tool === `${MCP_ASSISTANT_TOOL_PREFIX}${McpToolName.InvestigateDatabase}`;

export function readDatabaseInvestigation(output: string | undefined): DatabaseInvestigation | undefined {
  if (output === undefined) return undefined;
  try {
    const result = databaseInvestigationSchema.safeParse(JSON.parse(output));
    return result.success ? result.data : undefined;
  } catch (error) {
    // 对话输出可能被模型运行时截断，仅展示通过契约校验的调查结果。
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function DatabaseInvestigationEvidence({ investigation }: { investigation: DatabaseInvestigation }) {
  const turns = investigation.status === 'running' ? investigation.turns : investigation.turns.slice(0, -1);
  const previousIds = new Set(turns.flatMap(({ evidenceIds }) => evidenceIds));
  const currentEvidence = investigation.evidence.filter(({ id }) => !previousIds.has(id));
  return (
    <section className={styles.evidence} aria-label={C.evidence}>
      <div className="row wrap">
        <strong>{C.evidence}</strong>
        <span className="hint">{C.status[investigation.status]}</span>
      </div>
      <dl className={styles.metadata}>
        <dt>{C.id}</dt>
        <dd>
          <code>{investigation.investigationId}</code>
        </dd>
        <dt>{C.connection}</dt>
        <dd>{investigation.connection}</dd>
      </dl>
      {investigation.answer !== '' && <p className={styles.answer}>{investigation.answer}</p>}
      {currentEvidence.length > 0 && (
        <ol className={styles.queries}>
          {currentEvidence.map(({ id, kind, sql, rowCount, durationMs, truncated, summary }) => (
            <li key={id} className="col">
              <div className="row wrap">
                <strong>{C.kind[kind]}</strong>
                <span className="hint">
                  {rowCount !== null ? C.rows(rowCount) : C.rowsUnknown} · {C.duration(durationMs)}
                </span>
                {truncated && <span className="hint">{C.truncated}</span>}
              </div>
              {sql !== null && <pre className={styles.sql}>{sql}</pre>}
              {summary !== '' && <p className={styles.answer}>{summary}</p>}
              <small className="hint">
                {C.queryId} · <code>{id}</code>
              </small>
            </li>
          ))}
        </ol>
      )}
      {investigation.limitations.length > 0 && (
        <div className="col">
          <strong>{C.limitations}</strong>
          <ul>
            {[...new Set(investigation.limitations)].map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
