import { ErrorCode, type ErrorInfo, type TaskFailedPhase } from '@aw/shared';
import { z } from 'zod';
import { ERROR_COPY } from '../../copy/errors.ts';
import { TASK_COPY } from '../../copy/tasks.ts';

/** `details` of `NODE_ATTEMPTS_EXHAUSTED` (08): the step that ran out of attempts and its last check feedback. */
const exhaustedSchema = z.object({ nodeTitle: z.string(), feedback: z.string().nullable() });

export const exhaustedDetails = (error: ErrorInfo) =>
  error.code === ErrorCode.NodeAttemptsExhausted ? exhaustedSchema.parse(error.details) : undefined;

/** Why a task failed, naming the step when one did (14 §3.3); the task page and the inbox card say the same. */
export function failureText(phase: TaskFailedPhase, error: ErrorInfo): string {
  const exhausted = exhaustedDetails(error);
  return exhausted === undefined
    ? `${TASK_COPY.failedPhase[phase]}：${ERROR_COPY[error.code]}`
    : TASK_COPY.failedStep(exhausted.nodeTitle);
}
