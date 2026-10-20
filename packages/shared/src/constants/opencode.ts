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
 * Test commands of the tools a project check command runs (D64): when the check runs one of `tools`, read-only
 * sessions may also run `commands` with any arguments (`mvn -q test` also allows `mvn test -Dtest=X`). Only the
 * test commands, never another subcommand of the tool (`mvn deploy`, `npm publish`, `npm install`).
 */
const TEST_RUNNERS: ReadonlyArray<{ tools: readonly string[]; commands: readonly string[] }> = [
  {
    // Package scripts and the runners a test script usually calls.
    tools: ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'node'],
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
      'npx vitest run',
      'pnpm vitest run',
      'pnpm exec vitest run',
      'npx jest',
    ],
  },
  {
    // Quiet and offline in either order before the phase; more phases after it run them too (`mvn test deploy`).
    tools: ['mvn', './mvnw'],
    commands: ['mvn', './mvnw'].flatMap((mvn) =>
      ['', '-q ', '-o ', '-q -o ', '-o -q '].map((flags) => `${mvn} ${flags}test`),
    ),
  },
  {
    tools: ['./gradlew', 'gradle'],
    commands: ['./gradlew test', './gradlew -q test', 'gradle test', 'gradle -q test'],
  },
  { tools: ['go'], commands: ['go test'] },
  { tools: ['pytest', 'python', 'python3'], commands: ['pytest', 'python -m pytest', 'python3 -m pytest'] },
];

/** The only redirection allowed back after the escapes, for test commands and version queries (`java -version` prints to stderr). */
const STDERR_TO_STDOUT = ' 2>&1';

const bash = (pattern: string, action: PermissionAction): PermissionRule => ({ permission: 'bash', pattern, action });

/**
 * A version query is one command: a program name and the flag (`java -version`, `npx tsc --version`). The asks take
 * back longer commands that only end in the flag (`rm -rf src --version`) and paths, which run whatever the file is
 * (`./deploy.sh --version`). `suffix` is `''` or `STDERR_TO_STDOUT`.
 */
const versionQueryRules = (suffix: string): PermissionRule[] => [
  ...VERSION_FLAGS.flatMap((flag) => [
    bash(`* ${flag}${suffix}`, 'allow'),
    bash(`* * ${flag}${suffix}`, 'ask'),
    bash(`npx * ${flag}${suffix}`, 'allow'),
    bash(`npx * * ${flag}${suffix}`, 'ask'),
    bash(`*/* ${flag}${suffix}`, 'ask'),
  ]),
  ...VERSION_V_PROGRAMS.map((program) => bash(`${program} -v${suffix}`, 'allow')),
  bash(`go version${suffix}`, 'allow'),
];

/** The test commands of the tools the check commands run (`TEST_RUNNERS`). */
const sameToolTestCommands = (checkCommands: readonly string[]): string[] => {
  const tools = new Set(checkCommands.map((command) => command.trim().split(/\s+/)[0]));
  return [...new Set(TEST_RUNNERS.filter((r) => r.tools.some((t) => tools.has(t))).flatMap((r) => r.commands))];
};

/**
 * Bash rules of read-only sessions (12 §2). opencode applies the last matching rule, so the catch-all comes first:
 * version queries and the read-only list, the test commands of the check's tool, then the escapes (D63); after them
 * the same version queries and test commands followed by `2>&1` alone, a second redirection asks again, and the
 * check commands themselves (`<checkCommand>*`, D51) go last.
 */
export function readonlyBashRules(checkCommands: readonly string[] = []): PermissionRule[] {
  const tests = sameToolTestCommands(checkCommands);
  return [
    bash('*', 'ask'),
    ...versionQueryRules(''),
    ...BASH_READONLY.map((p) => bash(p, 'allow')),
    ...tests.map((c) => bash(`${c} *`, 'allow')),
    ...BASH_READONLY_ESCAPES.map((p) => bash(p, 'ask')),
    ...versionQueryRules(STDERR_TO_STDOUT),
    ...tests.flatMap((c) => [bash(`${c}${STDERR_TO_STDOUT}`, 'allow'), bash(`${c} *${STDERR_TO_STDOUT}`, 'allow')]),
    bash('*>*>*', 'ask'),
    ...[...new Set(checkCommands)].map((c) => bash(`${c}*`, 'allow')),
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
