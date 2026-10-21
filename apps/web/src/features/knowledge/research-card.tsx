import { type KnowledgeTurnDTO, KnowledgeTurnStatus } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Icon } from '../../components/icon.tsx';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import styles from './knowledge.module.css';
import { RESEARCH_STEPS, researchSteps } from './research-steps.ts';

/** Reads listed on the card; the rest are counted. */
const READS_SHOWN = 8;

/**
 * The research process of one question (18 §2.1): open while researching, folded into one line once there is an
 * answer. The stages come from the turn's session stream.
 */
export function ResearchCard({ turn, repoPath }: { turn: KnowledgeTurnDTO; repoPath: string }) {
  const { entries } = useTranscript(attemptTranscript(turn.attempt.id));
  const progress = researchSteps(entries, repoPath);
  const researching = turn.status === KnowledgeTurnStatus.Researching;
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const { startedAt, endedAt } = turn.attempt;
  const seconds = endedAt === null ? null : Math.max(1, Math.round((endedAt - startedAt) / 1000));
  const currentIndex = RESEARCH_STEPS.indexOf(progress.current);

  return (
    <details
      className={styles.process}
      open={open ?? researching}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid="research-process"
    >
      <summary className={styles.processHead}>
        {researching ? (
          <>
            <span className="dot pulse" aria-hidden="true" />
            <span>
              {C.process} · {C.step[progress.current]}
            </span>
            {turn.attempt.progress !== null && <span className="hint ellipsis">{turn.attempt.progress}</span>}
          </>
        ) : (
          <span>{C.processSummary(progress.reads.length, seconds)}</span>
        )}
      </summary>
      {turn.awaitingInput && (
        <p className={styles.waiting}>
          <Icon name="alert" size="sm" />
          <span className="grow">{C.awaitingInput}</span>
          <Link to={ROUTES.inbox} className="btn sm">
            {C.goHandle}
          </Link>
        </p>
      )}
      <ol className={styles.steps}>
        {RESEARCH_STEPS.map((step, i) => {
          const state = i < currentIndex || !researching ? 'done' : i === currentIndex ? 'current' : 'pending';
          return (
            <li key={step} className={styles.step} data-state={state}>
              <span className={styles.stepMark} aria-hidden="true">
                {state === 'done' ? <Icon name="check" size="sm" /> : i + 1}
              </span>
              <span className="col grow">
                <span>{C.step[step]}</span>
                {step === 'search' && progress.searches > 0 && (
                  <span className="hint">{C.searches(progress.searches)}</span>
                )}
                {step === 'read' && progress.reads.length > 0 && (
                  <span className={styles.reads}>
                    {progress.reads.slice(0, READS_SHOWN).map((read) => (
                      <span key={read} className="mono ellipsis">
                        {read}
                      </span>
                    ))}
                    {progress.reads.length > READS_SHOWN && (
                      <span className="hint">{C.reads(progress.reads.length)}</span>
                    )}
                  </span>
                )}
                {step === 'answer' && progress.rejected && researching && <span className="hint">{C.rejected}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
