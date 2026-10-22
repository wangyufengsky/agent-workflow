import { CheckUnrunnableReason, ErrorCode, type ErrorInfo, type TaskFailedPhase } from '@aw/shared';
import { z } from 'zod';
import { ERROR_COPY } from '../../copy/errors.ts';
import { TASK_COPY } from '../../copy/tasks.ts';

/**
 * `details` of `NODE_ATTEMPTS_EXHAUSTED` (08): the step that ran out of attempts, its last check feedback and the
 * command check it failed on (failures recorded before D116 have none).
 */
const exhaustedSchema = z.object({
  nodeTitle: z.string(),
  feedback: z.string().nullable(),
  command: z.string().nullable().default(null),
});

/** `details` of `CHECK_COMMAND_UNRUNNABLE` (08, D116). */
const unrunnableSchema = z.object({
  nodeTitle: z.string(),
  command: z.string(),
  program: z.string(),
  reason: z.enum(CheckUnrunnableReason),
});

export const exhaustedDetails = (error: ErrorInfo) =>
  error.code === ErrorCode.NodeAttemptsExhausted ? exhaustedSchema.parse(error.details) : undefined;

export const unrunnableDetails = (error: ErrorInfo) =>
  error.code === ErrorCode.CheckCommandUnrunnable ? unrunnableSchema.parse(error.details) : undefined;

/** The check command a failed task stopped on, which the user may change (D116); null when it failed otherwise. */
export const failedCommandOf = (error: ErrorInfo): string | null =>
  unrunnableDetails(error)?.command ?? exhaustedDetails(error)?.command ?? null;

/**
 * Why a task failed, naming the step when one did (14 §3.3), as inline Markdown (commands are code); the task page and
 * the inbox card say the same.
 */
export function failureText(phase: TaskFailedPhase, error: ErrorInfo): string {
  const unrunnable = unrunnableDetails(error);
  if (unrunnable !== undefined) {
    return TASK_COPY.unrunnable(unrunnable.nodeTitle, unrunnable.command, unrunnable.program, unrunnable.reason);
  }
  const exhausted = exhaustedDetails(error);
  return exhausted === undefined
    ? `${TASK_COPY.failedPhase[phase]}：${ERROR_COPY[error.code]}`
    : TASK_COPY.failedStep(exhausted.nodeTitle);
}
