import { AttemptStatus, DESIGN_REVIEW_BATCH_SIZE, type DesignDTO, type DesignRunDTO, DesignRunKind } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ATTEMPT_STATUS_LABEL } from '../../copy/attempts.ts';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { DESIGNS_COPY } from '../../copy/designs.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import { progressSection } from './design-reading.ts';
import styles from './design-workbench.module.css';

type RunPanelProps = {
  design: DesignDTO;
  active: DesignRunDTO | undefined;
  canGenerate: boolean;
  canRetryIncremental: boolean;
  latest: DesignRunDTO | undefined;
  onRetry: (run: DesignRunDTO) => void;
  onClose: () => void;
};

export function DesignRunPanel({
  design,
  active,
  canGenerate,
  canRetryIncremental,
  latest,
  onRetry,
  onClose,
}: RunPanelProps) {
  const [olderId, setOlderId] = useState<string>();
  const latestId = active?.id ?? latest?.id;
  const shown = active ?? design.runs.find(({ id }) => id === olderId) ?? latest;
  const sectionId = progressSection(shown);
  const title = design.sections.find(({ id }) => id === sectionId)?.title;
  const isIncremental = shown?.isIncremental === true;
  const canRetry =
    shown !== undefined &&
    shown.id === latestId &&
    active === undefined &&
    canGenerate &&
    (isIncremental
      ? canRetryIncremental &&
        (shown.attempt.status === AttemptStatus.Failed || shown.attempt.status === AttemptStatus.Aborted)
      : shown.attempt.status === AttemptStatus.Failed);
  const done = isIncremental ? shown.doneSectionIds.length : design.doneSections;
  const total = isIncremental ? shown.targetSectionIds.length : design.totalSections;
  return (
    <aside className={styles.activity} aria-label={C.attempts}>
      <div className={styles.paneTitle}>
        <strong>{C.attempts}</strong>
        <Button size="sm" variant="ghost" icon="chevRight" onClick={onClose} aria-label={C.hideAttempts} />
      </div>
      <div className={styles.activityBody}>
        {active?.awaitingInput && (
          <Link className="link" to={ROUTES.inbox}>
            {DESIGNS_COPY.permissions}
          </Link>
        )}
        <div className={styles.progress}>
          <span>{isIncremental ? C.incrementalProgress(done, total) : C.progress(done, total)}</span>
          {!isIncremental && (
            <span className="hint">
              {C.sessionPlan(
                design.totalSections,
                design.aiReviewEnabled ? Math.ceil(design.totalSections / DESIGN_REVIEW_BATCH_SIZE) : 0,
              )}
            </span>
          )}
          <progress value={done} max={Math.max(1, total)} aria-label={C.progress(done, total)} />
          {!design.handoffPending && title !== undefined && <span className="hint">{C.current(title)}</span>}
          {shown?.attempt.progress !== null && shown?.attempt.progress !== undefined && <p>{shown.attempt.progress}</p>}
        </div>
        {shown === undefined ? (
          <p className="hint">{C.noStarted}</p>
        ) : (
          <>
            {design.runs.length > 1 && active === undefined && (
              <label className="col">
                <span className="hint">{C.attemptHistory}</span>
                <select className="select" value={shown.id} onChange={(event) => setOlderId(event.currentTarget.value)}>
                  {design.runs.toReversed().map((run) => (
                    <option key={run.id} value={run.id}>
                      {C.runLabel(run.seq, ATTEMPT_STATUS_LABEL[run.attempt.status])}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shown.attempt.error !== null && <ErrorState error={shown.attempt.error} message={C.lastFailure} />}
            {canRetry && (
              <Button size="sm" icon="refresh" onClick={() => onRetry(shown)}>
                {isIncremental
                  ? C.incrementalRetry
                  : shown.kind === DesignRunKind.Generate
                    ? C.reattempt
                    : C.reattemptRun}
              </Button>
            )}
            <ConversationStream
              key={shown.attempt.id}
              attemptId={shown.attempt.id}
              title={C.runLabel(shown.seq, ATTEMPT_STATUS_LABEL[shown.attempt.status])}
              pro={false}
              size="side"
              foldOnEnd
              initiallyExpanded
              showLastActivity
            />
          </>
        )}
      </div>
    </aside>
  );
}
