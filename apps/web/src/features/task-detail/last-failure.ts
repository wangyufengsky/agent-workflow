import {
  AcceptanceCheckKind,
  AttemptKind,
  AttemptStatus,
  type CheckResult,
  type ErrorInfo,
  type NodeDetailDTO,
} from '@aw/shared';

type CommandCheck = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.Command }>;
type ReviewCheck = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.AiReview }>;
type PageCheck = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.Browser }>;

/** Why a failed step's last attempt did not get it done (D118). */
export type LastFailure =
  | { kind: 'command'; check: CommandCheck }
  | { kind: 'review'; check: ReviewCheck }
  | { kind: 'page'; check: PageCheck }
  | { kind: 'attempt'; aborted: boolean; error: ErrorInfo | null };

/**
 * The step's last execute attempt either submitted a result whose checks did not pass (the first failing check), or
 * ended without a result. Null when the step never ran, or its result passed every check it ran.
 */
export function lastFailure(node: NodeDetailDTO): LastFailure | null {
  const attempt = node.attempts.filter((a) => a.kind === AttemptKind.Execute).at(-1);
  if (attempt === undefined) return null;
  if (attempt.status !== AttemptStatus.Succeeded) {
    return { kind: 'attempt', aborted: attempt.status === AttemptStatus.Aborted, error: attempt.error };
  }
  const check = node.checkResults?.find((c) => !c.passed && !(c.kind !== AcceptanceCheckKind.AiReview && c.skipped));
  if (check === undefined) return null;
  switch (check.kind) {
    case AcceptanceCheckKind.Command:
      return { kind: 'command', check };
    case AcceptanceCheckKind.Browser:
      return { kind: 'page', check };
    case AcceptanceCheckKind.AiReview:
      return { kind: 'review', check };
  }
}

/** The last `lines` lines of a command's output, and whether anything was cut. */
export function outputTail(output: string, lines: number): { tail: string; cut: boolean } {
  const all = output.trimEnd().split('\n');
  return { tail: all.slice(-lines).join('\n'), cut: all.length > lines };
}
