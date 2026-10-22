import type { TaskResultDTO } from '@aw/shared';

/** Commands of the checks the user skipped after they could not run (D115): the result is not verified by them. */
export const skippedCommands = (result: TaskResultDTO): string[] => [
  ...new Set(result.checks.flatMap((c) => (c.skipped && c.command !== null ? [c.command] : []))),
];
