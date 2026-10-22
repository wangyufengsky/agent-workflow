import { type KnowledgeTurnDTO, KnowledgeTurnStatus, type TranscriptEntry } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Icon } from '../../components/icon.tsx';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { ConversationStream } from '../stream/conversation-stream.tsx';
import styles from './knowledge.module.css';
import { RESEARCH_STEPS, researchSteps } from './research-steps.ts';

/** The four stages in one line, the current one marked (18 §2.1). */
function Stages({ progress }: { progress: ReturnType<typeof researchSteps> }) {
  const currentIndex = RESEARCH_STEPS.indexOf(progress.current);
  return (
    <span className={styles.stages}>
      {RESEARCH_STEPS.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
        return (
          <span key={step} className={styles.stage} data-state={state}>
            {state === 'done' && <Icon name="check" size="sm" />}
            {C.step[step]}
            {step === 'search' && progress.searches > 0 && ` ${C.searches(progress.searches)}`}
            {step === 'answer' && progress.rejected && ` · ${C.rejected}`}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The research process of one question (18 §2.1, 25 §3): the turn's conversation stream in a box, the stages in its
 * header while researching; folded into one line once there is an answer.
 */
export function ResearchCard({
  turn,
  entries,
  repoPath,
  pro,
}: {
  turn: KnowledgeTurnDTO;
  /** The turn's session stream. */
  entries: readonly TranscriptEntry[];
  repoPath: string;
  pro: boolean;
}) {
  const progress = researchSteps(entries, repoPath);
  const researching = turn.status === KnowledgeTurnStatus.Researching;
  const { startedAt, endedAt } = turn.attempt;
  const seconds = endedAt === null ? null : Math.max(1, Math.round((endedAt - startedAt) / 1000));
  return (
    <>
      {turn.awaitingInput && (
        <p className={styles.waiting}>
          <Icon name="alert" size="sm" />
          <span className="grow">{C.awaitingInput}</span>
          <Link to={ROUTES.inbox} className="btn sm">
            {C.goHandle}
          </Link>
        </p>
      )}
      <ConversationStream
        attemptId={turn.attempt.id}
        title={C.process}
        summary={researching ? <Stages progress={progress} /> : C.processSummary(progress.reads.length, seconds)}
        pro={pro}
        size="card"
        testId="research-process"
      />
    </>
  );
}
