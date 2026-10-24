import { AcceptanceCheckKind, type TaskResultDTO } from '@aw/shared';
import { NODE_COPY } from '../../copy/tasks.ts';

/**
 * The checks the user skipped after they could not run (D116, 29 §7.4), as Markdown: each command once in code, and
 * the page check once. The result is not verified by them.
 */
export const skippedChecks = (result: TaskResultDTO): string[] => [
  ...new Set(
    result.checks.flatMap((c) =>
      !c.skipped
        ? []
        : c.kind === AcceptanceCheckKind.Browser
          ? [NODE_COPY.pageCheck]
          : c.command === null
            ? []
            : [`\`${c.command}\``],
    ),
  ),
];
