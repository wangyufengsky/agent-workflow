import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';
import { Platform } from '@aw/shared';

/** Login shells with plugin managers or slow version managers take a few seconds; past this the start goes on. */
export const LOGIN_SHELL_TIMEOUT_MS = 10_000;

/** Startup files may print banners before and after the command; the PATH is what lies between these. */
const MARKER = '__AW_LOGIN_SHELL_PATH__';
/** `printf` and `printenv` read the same in sh, bash, zsh and fish (where `$PATH` is a list). */
const PRINT_PATH = `printf ${MARKER}; printenv PATH; printf ${MARKER}`;

/**
 * The PATH the user's login shell sets up (`<shell> -ilc`, as a terminal opens it: `.zprofile`, `.zshrc` and the
 * like), started with `env`. Resolves as soon as the PATH has been printed: a background process the startup files
 * leave behind may hold the output open.
 */
export function readLoginShellPath(shell: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Its own session: an interactive shell started from a terminal (`pnpm dev`) would otherwise take the terminal.
    const child = spawn(shell, ['-ilc', PRINT_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      fail(new Error(`${shell} -ilc did not print PATH within ${timeoutMs} ms`));
      child.kill('SIGKILL');
    }, timeoutMs);
    function fail(error: Error) {
      clearTimeout(timer);
      reject(error);
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const [, path, end] = stdout.split(MARKER);
      if (end === undefined) return;
      clearTimeout(timer);
      resolve((path as string).trim());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', fail);
    child.on('close', (code, signal) =>
      fail(new Error(`${shell} -ilc exited (${signal ?? code}) without printing PATH: ${stderr.trim().slice(-500)}`)),
    );
  });
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
 * `env` with the PATH of the user's login shell, for the backend and through it check commands, opencode and git
 * (17 §3.12, D115). Windows has no login shell: its PATH comes from the registry for every process. When the shell
 * fails the reason is logged and `env` kept: the app still starts, and commands that need the missing directories
 * fail with "command not found" as before.
 */
export async function withLoginShellPath(
  os: Platform,
  env: NodeJS.ProcessEnv,
  shell: string,
  timeoutMs = LOGIN_SHELL_TIMEOUT_MS,
): Promise<NodeJS.ProcessEnv> {
  if (os === Platform.Win32) return env;
  const current = env.PATH ?? '';
  try {
    const path = mergePath(current, await readLoginShellPath(shell, env, timeoutMs));
    return path === current ? env : { ...env, PATH: path };
  } catch (e) {
    console.error('could not read PATH from the login shell; the backend keeps PATH', current, e);
    return env;
  }
}
