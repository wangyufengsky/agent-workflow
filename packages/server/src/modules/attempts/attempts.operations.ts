import { abortAttemptOp, getAttemptOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { AttemptsService } from './attempts.service.ts';

export function attemptOperations(attempts: AttemptsService) {
  return [
    implement(getAttemptOp, ({ id }) => attempts.get(id)),
    implement(abortAttemptOp, ({ id }) => attempts.abort(id)),
  ];
}
