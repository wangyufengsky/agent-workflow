import { getModelSlotsOp } from '@aw/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ATTEMPT_COPY } from '../../copy/attempts.ts';
import { attemptQuery } from './attempt.queries.ts';

/** Sessions using the model, the shared limit and the requests in line (D186); pushed by `model_slots.updated`. */
export const modelSlotsQuery = queryOptions({
  queryKey: queryKeys.modelSlots,
  queryFn: () => callOperation(getModelSlotsOp, {}),
});

/** Every slot is taken and something waits for one. */
export function useModelSlotsFull(): boolean {
  const slots = useQuery(modelSlotsQuery).data;
  return slots !== undefined && slots.queued > 0;
}

/** The line shown while work waits for a model slot. */
export function QueueNotice({ position }: { position: number | null }) {
  if (position === null) return null;
  return (
    <span className="hint" role="status" data-testid="model-queue">
      {ATTEMPT_COPY.queued(position)}
    </span>
  );
}

/** The same, for work whose DTO names only its attempt (a Git review, a breakdown, a member analysis). */
export function AttemptQueueNotice({ attemptId }: { attemptId: string }) {
  const attempt = useQuery(attemptQuery(attemptId)).data;
  return <QueueNotice position={attempt === undefined ? null : attempt.queuePosition} />;
}

/** Overview line: how busy the model is, when it is (14 §3.2). */
export function ModelSlotsLine() {
  const slots = useQuery(modelSlotsQuery).data;
  if (slots === undefined || (slots.inUse === 0 && slots.queued === 0)) return null;
  return <p className="hint">{ATTEMPT_COPY.modelSlots(slots.inUse, slots.limit, slots.queued)}</p>;
}
