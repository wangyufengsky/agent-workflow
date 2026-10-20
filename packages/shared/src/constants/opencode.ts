import { BashPolicy } from '../enums/system.ts';
import { MCP_SERVER_NAME } from './app.ts';

/** Prefix opencode puts before our MCP tool names (`agent-workflow_submit_result`). */
export const MCP_TOOL_PREFIX = `${MCP_SERVER_NAME}_`;
/** Argument the bridge plugin injects into our MCP tool calls with the calling session id (12 §3, D33). */
export const MCP_SESSION_ARG = '__aw_session';

/** How long `opencode serve` may take to print its address and answer `/config`. */
export const OPENCODE_START_TIMEOUT_MS = 30_000;

export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionRule = { permission: string; pattern: string; action: PermissionAction };

/** Git subcommands that only read; every other git command writes refs or the worktree, which is the backend's job. */
const GIT_READONLY = [
  'git status*',
  'git log*',
  'git diff*',
  'git show*',
  'git blame*',
  'git grep*',
  'git ls-files*',
  'git rev-parse*',
];
/**
 * Commands that only read the workspace or print; allowed without asking under every policy. Models exploring a
 * repository chain them with `echo` separators (M6-05 live runs, D61).
 */
const BASH_READONLY = [
  'ls*',
  'cat*',
  'head*',
  'tail*',
  'rg*',
  'grep*',
  'find*',
  'wc*',
  'echo*',
  'pwd',
  'which*',
  ...GIT_READONLY,
];

/**
 * Arguments that make a command of the read-only list write files or run other programs; such commands ask again
 * (D63). opencode matches each sub-command's full text, redirections included, so a redirect is caught here too.
 */
const BASH_READONLY_ESCAPES = [
  // Redirection: `cat a > b`, `echo x >> f`; also `2>&1`, which only `STDERR_TO_STDOUT` and the check commands allow again.
  '*>*',
  'find *-exec*',
  'find *-ok*',
  'find *-delete*',
  'find *-fprint*',
  'find *-fls*',
  'rg *--pre*',
  'git *--output*',
  'git grep *-O*',
  'git grep *--open-files-in-pager*',
];

/** Flags that only print a program's version (D64). */
const VERSION_FLAGS = ['--version', '-version', '-V'];
/** Programs whose `-v` is their version; for others it often means verbose (`rake -v` runs the default task). */
const VERSION_V_PROGRAMS = ['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'mvn', 'gradle', 'docker'];

/**
 * Test commands of the tools a project check command runs (D64): when the check starts with one of `tools`, read-only
 * sessions may also run `commands`. Only the test commands, never another subcommand of the tool (`mvn deploy`,
 * `npm publish`, `npm install`). `args`: `any` allows any arguments after the command; `flag` allows one argument
 * starting with `-` or one `valueFlags` option with its value, because any other word is another phase or task that
 * runs too (`mvn test deploy`, `./gradlew test publish`), and the check command itself is held to the same shape.
 * `escapes` are arguments that run another program; they ask even after the check command.
 */
type TestRunner = {
  tools: readonly string[];
  commands: readonly string[];
  args: 'any' | 'flag';
  valueFlags?: readonly string[];
  escapes?: readonly string[];
};
const TEST_RUNNERS: readonly TestRunner[] = [
  {
    // Package scripts and the runners a test script usually calls; `npx` only below, since it installs and runs a
    // package the project does not have.
    tools: ['npm', 'pnpm', 'yarn', 'bun', 'node'],
    commands: [
      'npm test',
      'npm run test',
      'npm t',
      'pnpm test',
      'pnpm run test',
      'yarn test',
      'yarn run test',
      'bun run test',
      'node --test',
      'pnpm vitest run',
      'pnpm exec vitest run',
    ],
    args: 'any',
  },
  { tools: ['npx vitest'], commands: ['npx vitest run'], args: 'any' },
  { tools: ['npx jest'], commands: ['npx jest'], args: 'any' },
  {
    // Quiet and offline in either order before the phase.
    tools: ['mvn', './mvnw'],
    commands: ['mvn', './mvnw'].flatMap((mvn) =>
      ['', '-q ', '-o ', '-q -o ', '-o -q '].map((flags) => `${mvn} ${flags}test`),
    ),
    args: 'flag',
  },
  {
    tools: ['./gradlew', 'gradle'],
    commands: ['./gradlew test', './gradlew -q test', 'gradle test', 'gradle -q test'],
    args: 'flag',
    valueFlags: ['--tests'],
  },
  { tools: ['go'], commands: ['go test'], args: 'any', escapes: ['go test *-exec*', 'go test *-toolexec*'] },
  {
    tools: ['pytest', 'python', 'python3'],
    commands: ['pytest', 'python -m pytest', 'python3 -m pytest'],
    args: 'any',
  },
];

/** The only redirection allowed back after the escapes, for test commands and version queries (`java -version` prints to stderr). */
const STDERR_TO_STDOUT = ' 2>&1';

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({ permission: 'bash', pattern, action });

/**
 * A version query is one command: a program name and the flag (`java -version`). The asks take back longer commands
 * that only end in the flag: `rm -rf src --version`, and `npx <package> --version`, which without a TTY installs and
 * runs any package from the registry; and paths, which run whatever the file is (`./deploy.sh --version`). `suffix`
 * is `''` or `STDERR_TO_STDOUT`.
 */
const versionQueryRules = (suffix: string): PermissionRule[] => [
  ...VERSION_FLAGS.flatMap((flag) => [
    bash(`* ${flag}${suffix}`, 'allow'),
    bash(`* * ${flag}${suffix}`, 'ask'),
    bash(`*/* ${flag}${suffix}`, 'ask'),
  ]),
  ...VERSION_V_PROGRAMS.map((program) => bash(`${program} -v${suffix}`, 'allow')),
  bash(`go version${suffix}`, 'allow'),
];

const startsWithWords = (command: string, words: string) => command === words || command.startsWith(`${words} `);

/**
 * Rules allowing `command` with the arguments its runner permits, followed by `suffix` (`''` or `STDERR_TO_STDOUT`).
 * The asks use ` ?*` rather than ` *`: opencode also matches a pattern ending in ` *` without that part.
 */
function testCommandRules(command: string, runner: TestRunner, suffix: string): PermissionRule[] {
  if (runner.args === 'any')
    return suffix === ''
      ? [bash(`${command} *`, 'allow')]
      : [bash(`${command}${suffix}`, 'allow'), bash(`${command} *${suffix}`, 'allow')];
  return [
    bash(`${command}${suffix}`, 'allow'),
    bash(`${command} -*${suffix}`, 'allow'),
    bash(`${command} -* ?*${suffix}`, 'ask'),
    ...(runner.valueFlags ?? []).flatMap((flag) => [
      bash(`${command} ${flag} *${suffix}`, 'allow'),
      bash(`${command} ${flag} * ?*${suffix}`, 'ask'),
    ]),
  ];
}

/**
 * Bash rules of read-only sessions (12 §2). opencode applies the last matching rule, so the catch-all comes first:
 * version queries and the read-only list, the test commands of the check's tool, then the escapes (D63); after them
 * the same version queries and test commands followed by `2>&1` alone, a second redirection asks again, the other
 * check commands (`<checkCommand>*`, D51), and last the test runners' own escapes.
 */
export function readonlyBashRules(checkCommands: readonly string[] = []): PermissionRule[] {
  const checks = [...new Set(checkCommands.map((c) => c.trim()))];
  const runners = TEST_RUNNERS.filter((r) => checks.some((c) => r.tools.some((t) => startsWithWords(c, t))));
  // A check command run by a `flag` runner gets that runner's shape instead of `<checkCommand>*`.
  const shaped = (c: string) => runners.find((r) => r.args === 'flag' && r.tools.some((t) => startsWithWords(c, t)));
  const tests = runners.flatMap((runner) =>
    [...new Set([...runner.commands, ...checks.filter((c) => shaped(c) === runner)])].map((command) => ({
      command,
      runner,
    })),
  );
  return [
    bash('*', 'ask'),
    ...versionQueryRules(''),
    ...BASH_READONLY.map((p) => bash(p, 'allow')),
    ...tests.flatMap(({ command, runner }) => testCommandRules(command, runner, '')),
    ...BASH_READONLY_ESCAPES.map((p) => bash(p, 'ask')),
    ...versionQueryRules(STDERR_TO_STDOUT),
    ...tests.flatMap(({ command, runner }) => testCommandRules(command, runner, STDERR_TO_STDOUT)),
    bash('*>*>*', 'ask'),
    ...checks.filter((c) => shaped(c) === undefined).map((c) => bash(`${c}*`, 'allow')),
    ...runners.flatMap((r) => r.escapes ?? []).map((p) => bash(p, 'ask')),
  ];
}

/**
 * Session-level bash rules of executors by `ai.bashPolicy` (12 §2, D35); planner and reviewer use
 * `readonlyBashRules`. `ask` is the read-only set without check commands.
 */
export const BASH_PERMISSION_PRESETS = {
  // Git is denied as a whole and only its read-only subcommands are allowed again (12 §1: the model never writes Git).
  [BashPolicy.Auto]: [bash('*', 'allow'), bash('git *', 'deny'), ...GIT_READONLY.map((p) => bash(p, 'allow'))],
  [BashPolicy.Ask]: readonlyBashRules(),
} as const satisfies Record<BashPolicy, readonly PermissionRule[]>;

/** Daily opencode log files in `<data dir>/logs` (03 §7): `opencode-YYYYMMDD.log`. */
export const opencodeLogFile = (date: string) => `opencode-${date}.log`;
export const OPENCODE_LOG_FILE_PATTERN = /^opencode-\d{8}\.log$/;
