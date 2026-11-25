import {
  type Acceptance,
  AcceptanceCheckKind,
  AttemptStatus,
  type CheckResult,
  ErrorCode,
  type ErrorInfo,
  MCP_TOOL_PREFIX,
  McpToolName,
  type NodeAcceptance,
  NodeStatus,
  PAGE_CHECK_VIEWPORTS,
  PROJECT_CHECK_PLACEHOLDER,
} from '@aw/shared';

export type AcceptanceProject = {
  checkCommand: string | null;
  previewPages: readonly string[] | null;
  useIdea?: boolean;
};

/** 仅完整的项目检查占位符参与自动选择；带参数或管道的自定义命令仍按原样展开。 */
function resolveCheck(check: Acceptance['checks'][number], project: AcceptanceProject): NodeAcceptance['checks'] {
  switch (check.kind) {
    case AcceptanceCheckKind.Command:
      if (project.useIdea && check.command === PROJECT_CHECK_PLACEHOLDER) {
        return [{ ...check, command: project.checkCommand ?? PROJECT_CHECK_PLACEHOLDER, autoProject: true }];
      }
      if (!check.command.includes(PROJECT_CHECK_PLACEHOLDER)) return [check];
      if (project.checkCommand === null) return [];
      return [{ ...check, command: check.command.replaceAll(PROJECT_CHECK_PLACEHOLDER, project.checkCommand) }];
    case AcceptanceCheckKind.Browser:
      if (project.previewPages === null) return [];
      return [
        {
          kind: AcceptanceCheckKind.Browser,
          pages: check.pages ?? [...project.previewPages],
          viewports: check.viewports ?? [...PAGE_CHECK_VIEWPORTS],
        },
      ];
    case AcceptanceCheckKind.AiReview:
      return [check];
  }
}

export function resolveAcceptance(
  acceptance: Acceptance,
  project: AcceptanceProject,
  acceptEachNode: boolean,
): NodeAcceptance {
  return {
    checks: acceptance.checks.flatMap((check) => resolveCheck(check, project)),
    manual: acceptance.manual || acceptEachNode,
  };
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

export function feedbackFromAttempt(
  status: AttemptStatus,
  error: ErrorInfo | null,
  submitTool: McpToolName = McpToolName.SubmitResult,
): string {
  if (status === AttemptStatus.Aborted) return 'The previous attempt was stopped by the user. Start the step again.';
  switch (error?.code) {
    case ErrorCode.AttemptNoResult:
      return `The previous attempt stopped without calling ${MCP_TOOL_PREFIX}${submitTool}. Finish the step and submit its result.`;
    case ErrorCode.AttemptContextBudget:
      return 'The previous request exceeded the model context budget. Reduce the input before retrying this step.';
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
      if (r.autoSelection?.source === 'idea') {
        return `The IDEA check (${r.autoSelection.configurations.join(', ')}) failed:\n${r.output.slice(-FEEDBACK_OUTPUT_CHARS)}`;
      }
      const how = r.timedOut ? 'timed out' : `exited with code ${r.exitCode}`;
      return `The check \`${r.command}\` ${how}. The end of its output:\n\n\`\`\`\n${r.output.slice(-FEEDBACK_OUTPUT_CHARS)}\n\`\`\``;
    }
    if (r.kind === AcceptanceCheckKind.Browser) {
      return `The page check did not pass:\n\n${r.output.slice(-FEEDBACK_OUTPUT_CHARS)}`;
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
