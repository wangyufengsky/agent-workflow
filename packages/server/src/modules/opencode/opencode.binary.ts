import { join } from 'node:path';
import { isSupportedOpencodeVersion, RuntimeStatus } from '@aw/shared';
import { execa } from 'execa';
import { host } from '../../core/platform.ts';

export type OpencodeDetection =
  | { status: typeof RuntimeStatus.NotInstalled; path?: string }
  | { status: typeof RuntimeStatus.VersionMismatch | typeof RuntimeStatus.Stopped; path: string; version: string };

/**
 * The configured path, else the first opencode on PATH, else `~/.opencode/bin` (the installer's default); on
 * Windows `opencode.exe` or npm's `opencode.cmd` launcher (17 §3.2).
 */
function locate(env: NodeJS.ProcessEnv, configuredPath: string | null): string | undefined {
  if (configuredPath !== null) return host.isExecutableFile(configuredPath) ? configuredPath : undefined;
  const home = host.homeDir(env);
  return host.findExecutable('opencode', [
    ...host.pathDirs(env),
    ...(home === undefined ? [] : [join(home, '.opencode', 'bin')]),
  ]);
}

/** Finds the opencode binary and checks its version is supported (D156); the runtime starts only from `stopped`. */
export async function detectOpencode(
  env: NodeJS.ProcessEnv,
  configuredPath: string | null,
): Promise<OpencodeDetection> {
  const path = locate(env, configuredPath);
  if (path === undefined) return { status: RuntimeStatus.NotInstalled };
  // execa runs npm's opencode.cmd through cmd.exe on Windows.
  const result = await execa(path, ['--version'], { env, extendEnv: false, reject: false });
  // A binary that cannot report its version cannot be hosted either.
  if (result.exitCode !== 0) return { status: RuntimeStatus.NotInstalled, path };
  const version = result.stdout.trim();
  return {
    status: isSupportedOpencodeVersion(version) ? RuntimeStatus.Stopped : RuntimeStatus.VersionMismatch,
    path,
    version,
  };
}
