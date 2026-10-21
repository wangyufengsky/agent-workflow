import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AppError, ErrorCode } from '@aw/shared';
import { host } from '../../core/platform.ts';
import { runGit } from './git.cli.ts';

/**
 * The POSIX shell that runs check commands (D68): /bin/sh, or on Windows the bash of Git for Windows, found from
 * git's own installation (`--exec-path`) because PATH may hold a forwarding shim (scoop). GIT_NOT_INSTALLED when
 * that git has no bash beside it (MinGit): commands must not fall back to cmd or PowerShell (D67).
 */
export async function locateShell(env: NodeJS.ProcessEnv): Promise<string> {
  if (!host.shellFromGit) return host.posixShell;
  const { stdout } = await runGit(['--exec-path'], { cwd: tmpdir(), env });
  const bash = host.gitBashOf(stdout.trim());
  if (!existsSync(bash)) throw new AppError(ErrorCode.GitNotInstalled, 'Git Bash not found beside git', { bash });
  return bash;
}

/** The shell opencode must use (`shell` in its config): Git Bash on Windows (D67), otherwise the user's own. */
export async function locateOpencodeShell(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return host.shellFromGit ? locateShell(env) : undefined;
}
