import { CheckUnrunnableReason } from '@aw/shared';

export type Unrunnable = { program: string; reason: CheckUnrunnableReason };

/** Exit codes a POSIX shell gives a command it could not run, and the words of its error line for each. */
const SHELL_ERRORS: Record<number, { reason: CheckUnrunnableReason; messages: readonly string[] }> = {
  127: {
    reason: CheckUnrunnableReason.NotFound,
    messages: ['command not found', 'not found', 'No such file or directory'],
  },
  126: { reason: CheckUnrunnableReason.NotExecutable, messages: ['Permission denied'] },
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The programs a command line runs itself: the first word of each part between `&&` `||` `;` `|`, after assignments. */
function programsOf(command: string): Set<string> {
  return new Set(
    command.split(/&&|\|\||;|\|/).flatMap((part) => {
      const program = part
        .trim()
        .split(/\s+/)
        .find((word) => !ASSIGNMENT.test(word));
      return program === undefined || program === '' ? [] : [program];
    }),
  );
}

/**
 * Whether the app's environment could not run a check command (D116): the shell exited 127 or 126 and its own error
 * line (`<shell>: [line N: |N: ]<program>: <message>`; the shell's name differs by platform) names a program the command line itself runs. Anything else is
 * an ordinary failing check, for the model to fix (a dependency the project's own scripts miss, a tool's own error).
 */
export function unrunnableOf(command: string, exitCode: number | null, output: string): Unrunnable | null {
  const expected = exitCode === null ? undefined : SHELL_ERRORS[exitCode];
  if (expected === undefined) return null;
  const programs = programsOf(command);
  for (const line of output.split('\n')) {
    const match = /^.+?: (?:line \d+: |\d+: )?(.+): ([^:]+)$/.exec(line.trimEnd());
    if (match === null) continue;
    const [, program = '', message = ''] = match;
    if (programs.has(program) && expected.messages.includes(message)) return { program, reason: expected.reason };
  }
  return null;
}
