import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { OPENCODE_VERSION, RuntimeStatus } from '@aw/shared';
import { execa } from 'execa';

export type OpencodeDetection =
  | { status: typeof RuntimeStatus.NotInstalled; path?: string }
  | { status: typeof RuntimeStatus.VersionMismatch | typeof RuntimeStatus.Stopped; path: string; version: string };

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    // Missing or not executable: this candidate is simply not an opencode binary.
    return false;
  }
}

/** The configured path, else the first `opencode` on PATH, else `~/.opencode/bin/opencode` (the installer's default). */
async function locate(env: NodeJS.ProcessEnv, configuredPath: string | null): Promise<string | undefined> {
  const candidates =
    configuredPath !== null
      ? [configuredPath]
      : [
          ...(env.PATH ?? '')
            .split(delimiter)
            .filter((dir) => dir !== '')
            .map((dir) => join(dir, 'opencode')),
          ...(env.HOME === undefined ? [] : [join(env.HOME, '.opencode', 'bin', 'opencode')]),
        ];
  for (const candidate of candidates) if (await isExecutableFile(candidate)) return candidate;
  return undefined;
}

/** Finds the opencode binary and checks it is exactly OPENCODE_VERSION; the runtime starts only from `stopped`. */
export async function detectOpencode(
  env: NodeJS.ProcessEnv,
  configuredPath: string | null,
): Promise<OpencodeDetection> {
  const path = await locate(env, configuredPath);
  if (path === undefined) return { status: RuntimeStatus.NotInstalled };
  const result = await execa(path, ['--version'], { env, extendEnv: false, reject: false });
  // A binary that cannot report its version cannot be hosted either.
  if (result.exitCode !== 0) return { status: RuntimeStatus.NotInstalled, path };
  const version = result.stdout.trim();
  return {
    status: version === OPENCODE_VERSION ? RuntimeStatus.Stopped : RuntimeStatus.VersionMismatch,
    path,
    version,
  };
}
