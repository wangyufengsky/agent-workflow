import {
  type Acceptance,
  AcceptanceCheckKind,
  AttemptStatus,
  type CheckResult,
  ErrorCode,
  type ErrorInfo,
  NodeStatus,
  PROJECT_CHECK_PLACEHOLDER,
} from '@aw/shared';

/**
 * The acceptance a node runs with (13 §1): `$PROJECT_CHECK` becomes the project's check command, or the check is
 * dropped when the project has none; the task's `accept_each_node` checkpoint adds manual acceptance (09 §3).
 */
export function resolveAcceptance(
  acceptance: Acceptance,
  checkCommand: string | null,
  acceptEachNode: boolean,
): Acceptance {
  const checks = acceptance.checks.flatMap((check) => {
    if (check.kind !== AcceptanceCheckKind.Command || !check.command.includes(PROJECT_CHECK_PLACEHOLDER))
      return [check];
    if (checkCommand === null) return [];
    return [{ ...check, command: check.command.replaceAll(PROJECT_CHECK_PLACEHOLDER, checkCommand) }];
  });
  return { checks, manual: acceptance.manual || acceptEachNode };
}

/** After a failed attempt or failed checks: another attempt while budget remains, otherwise failed (09 §3). */
export function nextAfterFailure(
  attemptCount: number,
  maxAttempts: number,
): typeof NodeStatus.Ready | typeof NodeStatus.Failed {
  return attemptCount < maxAttempts ? NodeStatus.Ready : NodeStatus.Failed;
}

/** Last part of a check's output given back to the model: enough to see the failure, not the whole log. */
const FEEDBACK_OUTPUT_CHARS = 3000;

// Feedback is part of the next attempt's prompt, so it is written for the model.

export function feedbackFromAttempt(status: AttemptStatus, error: ErrorInfo | null): string {
  if (status === AttemptStatus.Aborted) return 'The previous attempt was stopped by the user. Start the step again.';
  switch (error?.code) {
    case ErrorCode.AttemptNoResult:
      return 'The previous attempt stopped without calling agent-workflow_submit_result. Finish the step and submit its result.';
    case ErrorCode.AttemptTimeout:
      return 'The previous attempt ran out of time. Focus on what the step asks and submit the result as soon as it is done.';
    case ErrorCode.AttemptSessionError:
      return `The previous attempt failed with a session error (${error.message}). Start the step again.`;
    default:
      return `The previous attempt failed${error === null ? '' : ` (${error.code}: ${error.message})`}. Start the step again.`;
  }
}

export function feedbackFromChecks(results: readonly CheckResult[]): string {
  const failed = results.filter((r) => !r.passed);
  const parts = failed.map((r) => {
    if (r.kind === AcceptanceCheckKind.Command) {
      const how = r.timedOut ? 'timed out' : `exited with code ${r.exitCode}`;
      return `The check \`${r.command}\` ${how}. The end of its output:\n\n\`\`\`\n${r.output.slice(-FEEDBACK_OUTPUT_CHARS)}\n\`\`\``;
    }
    const issues = r.issues.map(
      (i) =>
        `- [${i.severity}] ${i.path === undefined ? '' : `${i.path}${i.line === undefined ? '' : `:${i.line}`} `}${i.description}`,
    );
    return [`The review did not pass: ${r.output}`, ...issues].join('\n');
  });
  return `Your result did not pass acceptance. Fix these problems and submit again.\n\n${parts.join('\n\n')}`;
}

export const feedbackFromRejection = (feedback: string): string =>
  `The user reviewed your result and asked for changes:\n\n${feedback}`;
