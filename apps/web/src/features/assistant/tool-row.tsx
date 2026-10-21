import { MCP_SESSION_ARG, OperationRisk, type TranscriptEntry, type TranscriptEntryKind } from '@aw/shared';
import { Icon, type IconName } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import styles from './cards.module.css';
import { InputSummary } from './input-summary.tsx';
import { describeTool } from './tool-label.ts';

type ToolCall = Extract<TranscriptEntry, { kind: typeof TranscriptEntryKind.ToolCall }>;
export type ToolResult = Extract<TranscriptEntry, { kind: typeof TranscriptEntryKind.ToolResult }>;

type RowState = 'running' | 'done' | 'failed' | 'stopped';
const STATE_ICON: Record<Exclude<RowState, 'running'>, IconName> = { done: 'check', failed: 'alert', stopped: 'stop' };

/** The input as the model gave it: the session id the bridge plugin adds is plumbing (15 §2). */
const rawInput = (input: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => key !== MCP_SESSION_ARG)), null, 2);

/**
 * A tool call and its result as one compact action row (15 §6): status, what it does in words and what it works on.
 * It opens to the input in words for a write that ran without a card (always allowed); pro mode adds the tool's
 * internal name and raw input and output.
 */
export function ToolRow({
  call,
  result,
  busy,
  pro,
}: {
  call: ToolCall;
  result: ToolResult | undefined;
  /** The conversation is still working: a call without a result runs rather than was stopped. */
  busy: boolean;
  pro: boolean;
}) {
  const { tool, input } = call.data;
  const info = describeTool(tool, input);
  const state: RowState =
    result === undefined ? (busy ? 'running' : 'stopped') : result.data.status === 'error' ? 'failed' : 'done';
  // Writes ran without a card only when always allowed; their input reads like the card's.
  const summarized =
    info.operation?.risk === OperationRisk.Write || info.operation?.risk === OperationRisk.Critical
      ? info.operation
      : undefined;
  const head = (
    <>
      <span className={styles.actionIcon} aria-hidden="true">
        {state === 'running' ? <span className={styles.actionPulse} /> : <Icon name={STATE_ICON[state]} size="sm" />}
      </span>
      <span className={state === 'running' ? `${styles.actionTitle} ${styles.shimmer}` : styles.actionTitle}>
        {info.title}
      </span>
      {info.subject !== undefined && <span className={styles.actionSubject}>{info.subject}</span>}
      {state === 'failed' && <span className={styles.actionNote}>{C.toolFailed}</span>}
      {state === 'stopped' && <span className={styles.actionNote}>{C.toolStopped}</span>}
    </>
  );
  if (!pro && summarized === undefined) {
    return (
      <div className={styles.action} data-state={state} data-testid="assistant-action">
        <div className={styles.actionHead}>{head}</div>
      </div>
    );
  }
  return (
    <details className={styles.action} data-state={state} data-testid="assistant-action">
      <summary className={styles.actionHead}>
        {head}
        <span className={styles.actionChevron} aria-hidden="true">
          <Icon name="chevRight" size="sm" />
        </span>
      </summary>
      <div className={styles.actionBody}>
        {summarized !== undefined && <InputSummary operation={summarized} input={input} />}
        {pro && (
          <>
            <p className={styles.actionMeta}>
              {C.toolName} <span className="mono">{tool}</span>
            </p>
            <pre className={styles.json}>{rawInput(input)}</pre>
            {result !== undefined && (
              <pre className={styles.json}>
                {result.data.status === 'error' ? result.data.error : result.data.output}
              </pre>
            )}
          </>
        )}
      </div>
    </details>
  );
}
