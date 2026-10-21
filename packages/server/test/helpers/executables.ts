import { execFileSync } from 'node:child_process';
import { chmod, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Platform } from '@aw/shared';
import { host } from '../../src/core/platform.ts';

// Test-side platform differences live here only (17 §4.2); the tests themselves do not branch on the platform.
const isWindows = host.os === Platform.Win32;

/**
 * A stand-in command `name` in `dir` that runs the JavaScript module `source` with its arguments: an executable sh
 * script, or on Windows a `.cmd` launcher (the form npm installs, D71). Returns the file to expect as its path.
 */
export async function writeFakeExecutable(dir: string, name: string, source: string): Promise<string> {
  const script = join(dir, `${name}.mjs`);
  await writeFile(script, source);
  if (isWindows) {
    const file = join(dir, `${name}.cmd`);
    await writeFile(file, `@"${process.execPath}" "${script}" %*\r\n`);
    return file;
  }
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(file, 0o755);
  return file;
}

/** A fake that prints `version` for `--version` (all environment detection runs). */
export function writeFakeVersion(dir: string, name: string, version: string): Promise<string> {
  return writeFakeExecutable(dir, name, `console.log(${JSON.stringify(version)});\n`);
}

const REAL_GIT = isWindows
  ? (execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0] ?? '')
  : execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

/**
 * An environment that finds only what is in `bin` (and git when asked) and whose home is `home`. POSIX links git
 * into `bin`; Git for Windows' launcher finds its installation relative to itself, so there its own directory is
 * added instead, together with the variables Windows programs need.
 */
export async function isolatedEnv(bin: string, home: string, options: { git: boolean }): Promise<NodeJS.ProcessEnv> {
  if (!isWindows) {
    if (options.git) await symlink(REAL_GIT, join(bin, 'git'));
    return { PATH: bin, HOME: home };
  }
  const path = options.git ? `${bin};${dirname(REAL_GIT)}` : bin;
  const keep = ['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'];
  return {
    ...Object.fromEntries(keep.map((name) => [name, host.envValue(process.env, name)])),
    PATH: path,
    USERPROFILE: home,
  };
}
