import { MCP_SESSION_ARG } from '@aw/shared';
import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { actionGroupSummary, STREAM_COPY as C, toolActionDelta, toolActionText } from '../../copy/attempts.ts';
import styles from './stream.module.css';
import type { StreamAction } from './stream-items.ts';

/** The input as the model gave it: the session id the bridge plugin adds is plumbing. */
const rawInput = (input: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => key !== MCP_SESSION_ARG)), null, 2);

function Mark({ state }: { state: StreamAction['state'] }) {
  return (
    <span className={styles.actionMark} role="img" aria-label={C.state[state]}>
      {state === 'running' ? (
        <span className={styles.pulse} />
      ) : (
        <Icon name={state === 'ok' ? 'check' : state === 'failed' ? 'x' : 'stop'} size="sm" />
      )}
    </span>
  );
}

/**
 * One tool call as one line (25 §4.3): its outcome, the verb, what it works on and the lines an edit changed. A failed
 * call opens to its error; in pro mode every call opens to the internal tool name and the raw input and output.
 */
export function ActionBar({ item, pro }: { item: StreamAction; pro: boolean }) {
  const [open, setOpen] = useState(false);
  const { verb, subject } = toolActionText(item.action);
  const delta = toolActionDelta(item.action);
  const expandable = pro || item.state === 'failed';
  const head = (
    <>
      <Mark state={item.state} />
      <span className={item.state === 'running' ? `${styles.verb} shimmer` : styles.verb}>{verb}</span>
      {subject !== '' && (
        <span className={styles.subject} title={subject}>
          {subject}
        </span>
      )}
      {delta !== undefined && (
        <span className={styles.delta}>
          <span className={styles.added}>+{delta.added}</span> <span className={styles.removed}>−{delta.removed}</span>
        </span>
      )}
      {item.state === 'failed' && <span className={styles.failedNote}>{C.failedNote}</span>}
    </>
  );
  if (!expandable)
    return (
      <div className={styles.action} data-state={item.state} data-testid="stream-action">
        <div className={styles.actionHead}>{head}</div>
      </div>
    );
  return (
    <div className={styles.action} data-state={item.state} data-testid="stream-action">
      <button type="button" className={styles.actionHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        {head}
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevRight" size="sm" />
        </span>
      </button>
      {open && (
        <div className={styles.actionBody}>
          {pro && (
            <>
              <span className={styles.rawLabel}>
                {C.toolName} <span className="mono">{item.tool}</span> · {C.input}
              </span>
              <pre className={styles.raw}>{rawInput(item.input)}</pre>
              {item.output !== undefined && <span className={styles.rawLabel}>{C.output}</span>}
            </>
          )}
          {item.output !== undefined && (
            <pre className={styles.raw} data-failed={item.state === 'failed'}>
              {item.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Calls in a row of an ended stream, folded into one line; a group with a failed call starts open. */
export function ActionGroup({ actions, pro }: { actions: StreamAction[]; pro: boolean }) {
  const [open, setOpen] = useState(() => actions.some((a) => a.state === 'failed'));
  return (
    <div className={styles.group} data-testid="stream-group">
      <button type="button" className={styles.groupHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="chevRight" size="sm" />
        </span>
        <span className={styles.groupIcon} aria-hidden="true">
          <Icon name="layers" size="sm" />
        </span>
        <span>{actionGroupSummary(actions)}</span>
      </button>
      {open && (
        <div className={styles.groupBody}>
          {actions.map((a) => (
            <ActionBar key={a.key} item={a} pro={pro} />
          ))}
        </div>
      )}
    </div>
  );
}
