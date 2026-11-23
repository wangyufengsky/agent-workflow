import { AcceptanceCheckKind, PROJECT_CHECK_PLACEHOLDER, type TaskResultDTO } from '@aw/shared';
import { NODE_COPY } from '../../copy/tasks.ts';

export const noAutomaticCheck = (check: {
  kind: TaskResultDTO['checks'][number]['kind'];
  skipped?: boolean | undefined;
  command?: string | null | undefined;
  autoSelection?: { source: 'idea' | 'fallback' } | undefined;
}): boolean =>
  check.kind === AcceptanceCheckKind.Command &&
  check.skipped === true &&
  check.autoSelection?.source === 'fallback' &&
  check.command === PROJECT_CHECK_PLACEHOLDER;

/**
 * The checks the user skipped after they could not run (D116, 29 §7.4), as Markdown: each command once in code, and
 * the page check once. The result is not verified by them.
 */
export const skippedChecks = (result: TaskResultDTO): string[] => [
  ...new Set(
    result.checks.flatMap((c) =>
      !c.skipped || noAutomaticCheck(c)
        ? []
        : c.kind === AcceptanceCheckKind.Browser
          ? [NODE_COPY.pageCheck]
          : c.command === null
            ? []
            : [`\`${c.command}\``],
    ),
  ),
];
