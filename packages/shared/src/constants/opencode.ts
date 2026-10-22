import { BashPolicy } from '../enums/system.ts';
import { MCP_ASSISTANT_SERVER_NAME, MCP_SERVER_NAME } from './app.ts';

/** Prefix opencode puts before our MCP tool names (`agent-workflow_submit_result`). */
export const MCP_TOOL_PREFIX = `${MCP_SERVER_NAME}_`;
/** Prefix of the assistant MCP's tools in opencode (`agent-workflow-app_tasks_list`). */
export const MCP_ASSISTANT_TOOL_PREFIX = `${MCP_ASSISTANT_SERVER_NAME}_`;
/** Argument the bridge plugin injects into our MCP tool calls with the calling session id (12 §3, D33). */
export const MCP_SESSION_ARG = '__aw_session';

/** How long `opencode serve` may take to print its address and answer `/config`. */
export const OPENCODE_START_TIMEOUT_MS = 30_000;

export type PermissionAction = 'allow' | 'ask' | 'deny';
/** opencode's permission type of shell commands. */
export const BASH_PERMISSION = 'bash';
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
 * repository chain them with `echo` separators (M6-05 live runs, D61). The second group (D100) is written `X *`, so
 * `du` does not also allow `dump`; `sed` only prints (`-n` and a script ending in `p`), `uniq` without an output file.
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
  'sort *',
  'uniq',
  'uniq -*',
  'cut *',
  'tr *',
  'nl *',
  'awk *',
  ...['p', "p'", 'p"'].map((end) => `sed -n *${end} *`),
  'unzip -l *',
  'unzip -Z *',
  ...['tf', 'tvf', '-tf', '-tvf', '--list'].map((list) => `jar ${list} *`),
  'javap *',
  'file *',
  'stat *',
  'du *',
  'tree *',
  'diff *',
  'command -v *',
  'command -V *',
  'type *',
  'basename *',
  'dirname *',
  'realpath *',
  'readlink *',
];

/**
 * sed commands that write (`w`, `W`) or run (`e`) inside a script (D100). Wildcards cannot parse the script, so these
 * ask when such a letter comes before the `p` that ends an unquoted script, or anywhere inside quotes; an address
 * regex with one of the letters asks too.
 */
const SED_SCRIPT_ESCAPES = ['w', 'W', 'e'].flatMap((letter) => [
  ...['p', "p'", 'p"'].map((end) => `sed -n *${letter}*${end} *`),
  `sed -n *'*${letter}*'*`,
  `sed -n *"*${letter}*"*`,
]);

/**
 * Arguments that make a command of the read-only list write files or run other programs; such commands ask again
 * (D63, D100). opencode matches each sub-command's full text, redirections included, so a redirect is caught by
 * `REDIRECT`; the others are `COMMAND_ESCAPES`.
 */
const REDIRECT = '*>*';
const COMMAND_ESCAPES = [
  'find *-exec*',
  'find *-ok*',
  'find *-delete*',
  'find *-fprint*',
  'find *-fls*',
  'rg *--pre*',
  'git *--output*',
  'git grep *-O*',
  'git grep *--open-files-in-pager*',
  // In-place editing (`-I` on macOS), a script from a file, or more scripts after the first.
  'sed *-i*',
  'sed *-I*',
  'sed *-f*',
  'sed *-e*',
  ...SED_SCRIPT_ESCAPES,
  // A program from a file or a library, and pipes to or from commands (`print | "sh"`, `"cmd" | getline`).
  'awk *system*',
  'awk *|*',
  'awk *-f*',
  'awk *-E*',
  'awk *--exec*',
  'awk *-i*',
  'awk *-l*',
  'awk *@load*',
  'sort *-o*',
  'sort *--compress-program*',
  // Two file arguments: the second is the output.
  'uniq -* ?*',
  // Options for the JVM, which can load an agent.
  'javap *-J*',
  'file *-C*',
  'file *--compile*',
  'tree *-o*',
  'tree *-R*',
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

/**
 * The only redirections allowed back after the escapes, at the end of a command (`java -version` prints to stderr):
 * stderr into stdout, or thrown away (D100). Neither writes a file.
 */
const STDERR_SUFFIXES = [' 2>&1', ' 2>/dev/null'];

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({
  permission: BASH_PERMISSION,
  pattern,
  action,
});

/**
 * A version query is one command: a program name and the flag (`java -version`). The asks take back longer commands
 * that only end in the flag: `rm -rf src --version`, and `npx <package> --version`, which without a TTY installs and
 * runs any package from the registry; and paths, which run whatever the file is (`./deploy.sh --version`). `suffix`
 * is `''` or one of `STDERR_SUFFIXES`.
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
 * The patterns of a bash request's「总是允许」that are remembered for the project (D101): opencode's own (`unzip *`),
 * except Git ones, since the model never writes Git (12 §1); those stay with opencode's session.
 */
export const projectBashPatterns = (always: readonly string[]): string[] =>
  always.filter((pattern) => !startsWithWords(pattern, 'git'));

/**
 * Rules allowing `command` with the arguments its runner permits, followed by `suffix` (`''` or one of `STDERR_SUFFIXES`).
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

/** `pattern` followed by `suffix`; a trailing ` *` may match nothing, so `X *` also gets `X<suffix>`. */
const withSuffix = (pattern: string, suffix: string) =>
  pattern.endsWith(' *') ? [`${pattern.slice(0, -2)}${suffix}`, `${pattern}${suffix}`] : [`${pattern}${suffix}`];

/**
 * Bash rules of read-only sessions (12 §2). opencode applies the last matching rule, so the catch-all comes first:
 * version queries and the read-only list, the test commands of the check's tool and the project's always-allowed
 * patterns (`allowedBash`, D101), then the escapes (D63, D100); after them the same allows followed by one stderr
 * redirection alone (`2>&1`, `2>/dev/null`), a second redirection asks again, the other check commands
 * (`<checkCommand>*`, D51), and last the command escapes again, so a suffix does not let them through, with the test
 * runners' own escapes.
 */
export function readonlyBashRules(
  checkCommands: readonly string[] = [],
  allowedBash: readonly string[] = [],
): PermissionRule[] {
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
  const allows = (suffix: string): PermissionRule[] => [
    ...versionQueryRules(suffix),
    ...BASH_READONLY.flatMap((p) => withSuffix(p, suffix)).map((p) => bash(p, 'allow')),
    ...tests.flatMap(({ command, runner }) => testCommandRules(command, runner, suffix)),
    ...allowedBash.flatMap((p) => withSuffix(p, suffix)).map((p) => bash(p, 'allow')),
  ];
  const escapes = COMMAND_ESCAPES.map((p) => bash(p, 'ask'));
  return [
    bash('*', 'ask'),
    ...allows(''),
    bash(REDIRECT, 'ask'),
    ...escapes,
    ...STDERR_SUFFIXES.flatMap(allows),
    bash('*>*>*', 'ask'),
    ...checks.filter((c) => shaped(c) === undefined).map((c) => bash(`${c}*`, 'allow')),
    ...escapes,
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
