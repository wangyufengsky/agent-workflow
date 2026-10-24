import {
  type InitiativeDetailDTO,
  InitiativeItemStatus,
  InitiativeRunMode,
  InitiativeStatus,
  UiMode,
} from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import { INITIATIVES_COPY as C } from '../../copy/initiatives.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import styles from './initiatives.module.css';
import { useRebreakdownInitiative, useRefineInitiative } from './initiatives.queries.ts';

/** Work packages the AI may still rewrite: not started, not dropped (D136). */
export const hasOpenItems = (initiative: InitiativeDetailDTO, fromPhase = 1) =>
  initiative.items.some(
    (item) => item.phase >= fromPhase && item.task === null && item.status !== InitiativeItemStatus.Dropped,
  );

/** A button that asks for optional feedback before starting an AI run (re-breakdown, refinement). */
function WithInstruction({
  label,
  title,
  body,
  variant = 'secondary',
  pending,
  error,
  onRun,
}: {
  label: string;
  title: string;
  body: string;
  variant?: 'primary' | 'secondary';
  pending: boolean;
  error: unknown;
  onRun: (instruction: string | undefined, close: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={body}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{COMMON_COPY.cancel}</Button>
            <Button
              variant="primary"
              pending={pending}
              onClick={() => onRun(instruction.trim() === '' ? undefined : instruction.trim(), () => setOpen(false))}
            >
              {label}
            </Button>
          </>
        }
      >
        <label className="col">
          <span className="hint">{C.instruction}</span>
          <textarea className="input" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </label>
        {error !== null && <ErrorState error={error} />}
      </Dialog>
    </>
  );
}

/** 「按意见重新拆解」/「重新拆解」before the draft is confirmed (34 §5.2). */
export function RebreakdownButton({ initiative, label }: { initiative: InitiativeDetailDTO; label: string }) {
  const rebreakdown = useRebreakdownInitiative();
  return (
    <WithInstruction
      label={label}
      title={C.rebreakdownTitle}
      body={C.rebreakdownBody}
      pending={rebreakdown.isPending}
      error={rebreakdown.error}
      onRun={(instruction, close) =>
        rebreakdown.mutate(
          { id: initiative.id, ...(instruction === undefined ? {} : { instruction }) },
          { onSuccess: close },
        )
      }
    />
  );
}

/** 「细化剩余工作包」at any time after confirming (34 §5.5): only what has not started changes. */
export function RefineButton({ initiative }: { initiative: InitiativeDetailDTO }) {
  const refine = useRefineInitiative();
  return (
    <WithInstruction
      label={C.refine}
      title={C.refineTitle}
      body={C.refineBody}
      pending={refine.isPending}
      error={refine.error}
      onRun={(instruction, close) =>
        refine.mutate(
          { id: initiative.id, ...(instruction === undefined ? {} : { instruction }) },
          { onSuccess: close },
        )
      }
    />
  );
}

const RUNNING_TEXT = {
  [InitiativeRunMode.Breakdown]: C.breakingDown,
  [InitiativeRunMode.Rebreakdown]: C.rebreakingDown,
  [InitiativeRunMode.Refine]: C.refining,
} as const;

/**
 * The AI's breakdown while it works and when it failed (34 §6.2): what it is doing, its session, and a retry. The
 * session's own stream shows what it reads; the page follows `initiative.updated` when it ends.
 */
export function BreakdownStatus({ initiative }: { initiative: InitiativeDetailDTO }) {
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const run = initiative.latestRun;
  if (run === null) return null;
  if (initiative.status === InitiativeStatus.BreakingDown) {
    return (
      <section className="col" data-testid="initiative-breakdown">
        <div className="banner">
          <span className="spin" aria-hidden="true" />
          <span className="grow">{RUNNING_TEXT[run.mode]}</span>
        </div>
        <ConversationStream
          attemptId={run.attemptId}
          title={C.process}
          pro={pro}
          size="card"
          testId="breakdown-process"
        />
      </section>
    );
  }
  if (initiative.status === InitiativeStatus.BreakdownFailed) {
    return (
      <div className="banner danger" role="alert" data-testid="initiative-breakdown">
        <span className="grow">
          {C.breakdownFailed}
          {run.error !== null && ` ${ERROR_COPY[run.error.code]}`}
        </span>
        <RebreakdownButton initiative={initiative} label={C.retry} />
      </div>
    );
  }
  return null;
}

/** What the AI understood and which work package does each point of the requirement (34 §5.2). */
export function Understanding({ initiative }: { initiative: InitiativeDetailDTO }) {
  const { understanding, coverage, summary } = initiative;
  if (understanding === null && coverage === null && summary === null) return null;
  const title = (key: string) => initiative.items.find((i) => i.key === key)?.title ?? key;
  const lists: Array<[string, readonly string[]]> =
    understanding === null
      ? []
      : [
          [C.outOfScope, understanding.out_of_scope],
          [C.assumptions, understanding.assumptions],
          [C.risks, understanding.risks],
        ];
  const covered = coverage?.filter((line) => line.items.length > 0).length ?? 0;
  return (
    <section className="card pad col" data-testid="initiative-understanding">
      {summary !== null && <p>{summary}</p>}
      {understanding !== null && (
        <details>
          <summary className="hint">{C.understanding}</summary>
          <p className={styles.requirement}>
            <span className="hint">{C.scope}：</span>
            {understanding.scope}
          </p>
          {lists.map(([label, entries]) =>
            entries.length === 0 ? null : (
              <div key={label} className="col">
                <span className="hint">{label}</span>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </details>
      )}
      {coverage !== null && (
        <details>
          <summary className="hint">{C.coverageSummary(covered, coverage.length)}</summary>
          <table className={styles.table}>
            <tbody>
              {coverage.map((line) => (
                <tr key={line.point}>
                  <td>{line.point}</td>
                  <td>{line.items.length === 0 ? C.coverageNone : line.items.map(title).join('、')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
