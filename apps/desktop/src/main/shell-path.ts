import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';
import { Platform } from '@aw/shared';

/** Login shells with plugin managers or slow version managers take a few seconds; past this the start goes on. */
export const LOGIN_SHELL_TIMEOUT_MS = 10_000;

/** Startup files may print banners before and after the command; the environment is what lies between these. */
const MARKER = '__AW_LOGIN_SHELL_ENV__';
/** `env -0` ends each variable with NUL, so values with newlines stay whole; the same in sh, bash, zsh and fish. */
const PRINT_ENV = `printf ${MARKER}; env -0; printf ${MARKER}`;
/** Describe the shell that printed them, not the user's environment. */
const SHELL_OWN = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

/**
 * The environment the user's login shell sets up (`<shell> -ilc`, as a terminal opens it: `.zprofile`, `.zshrc` and
 * the like), started with `env`. Resolves as soon as it has been printed: a background process the startup files
 * leave behind may hold the output open.
 */
export function readLoginShellEnv(
  shell: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve, reject) => {
    // Its own session: an interactive shell started from a terminal (`pnpm dev`) would otherwise take the terminal.
    const child = spawn(shell, ['-ilc', PRINT_ENV], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      fail(new Error(`${shell} -ilc did not print its environment within ${timeoutMs} ms`));
      child.kill('SIGKILL');
    }, timeoutMs);
    function fail(error: Error) {
      clearTimeout(timer);
      reject(error);
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const [, printed, end] = stdout.split(MARKER);
      if (end === undefined) return;
      clearTimeout(timer);
      resolve(parseEnv(printed as string));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', fail);
    child.on('close', (code, signal) =>
      fail(
        new Error(
          `${shell} -ilc exited (${signal ?? code}) without printing its environment: ${stderr.trim().slice(-500)}`,
        ),
      ),
    );
  });
}

/** `env -0` output: `NAME=value` entries ended by NUL; the value may hold `=` and newlines. */
function parseEnv(printed: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of printed.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!SHELL_OWN.has(name)) env[name] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * The PATH to keep: `current` when it already has every directory of the login shell's (started from a terminal),
 * otherwise the login shell's in its order followed by what only `current` has (started from Finder, the Dock or a
 * desktop launcher, which give `/usr/bin:/bin:/usr/sbin:/sbin`; Homebrew's `/opt/homebrew/bin` must come before
 * `/usr/bin`, whose `java` and `git` are stubs).
 */
export function mergePath(current: string, login: string): string {
  const currentDirs = current.split(delimiter).filter((dir) => dir !== '');
  const loginDirs = login.split(delimiter).filter((dir) => dir !== '');
  if (loginDirs.every((dir) => currentDirs.includes(dir))) return current;
  return [...new Set([...loginDirs, ...currentDirs])].join(delimiter);
}

/**
 * `env` with what the user's login shell adds (17 §3.12, D117, D161): its variables that `env` does not have (an
 * intranet provider's API key, `NODE_EXTRA_CA_CERTS`, proxies, `JAVA_HOME` …) and its PATH, for the backend and through
 * it check commands, opencode and git. Variables `env` already has keep their value: started from a terminal they are
 * what the user exported there. Windows has no login shell: its environment comes from the registry for every process.
 * When the shell fails the reason is logged and `env` kept: the app still starts, and what needs the missing variables
 * fails as before.
 */
export async function withLoginShellEnv(
  os: Platform,
  env: NodeJS.ProcessEnv,
  shell: string,
  timeoutMs = LOGIN_SHELL_TIMEOUT_MS,
): Promise<NodeJS.ProcessEnv> {
  if (os === Platform.Win32) return env;
  try {
    const login = await readLoginShellEnv(shell, env, timeoutMs);
    return { ...login, ...env, PATH: mergePath(env.PATH ?? '', login.PATH ?? '') };
  } catch (e) {
    console.error('could not read the environment of the login shell; the backend keeps its own', e);
    return env;
  }
}
