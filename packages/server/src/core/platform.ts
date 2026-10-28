import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { Platform, platformSchema } from '@aw/shared';

/**
 * Everything that differs between the operating systems the backend runs on (17 §2, D71). Built per platform so
 * the Windows rules can be unit-tested anywhere; the rest of the backend uses `host`. Starting `.cmd` launchers and
 * ending a process with its descendants are left to execa (Windows command resolution, `killDescendants`).
 */
export function platformRules(os: Platform) {
  const isWindows = os === Platform.Win32;
  const paths = isWindows ? path.win32 : path.posix;

  /** Windows environment variable names are case-insensitive (`Path`), a copied env object is not. */
  function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
    if (!isWindows) return env[name];
    const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
    return key === undefined ? undefined : env[key];
  }

  function isExecutableFile(file: string): boolean {
    try {
      if (!isWindows) accessSync(file, constants.X_OK);
      return statSync(file).isFile();
    } catch {
      // Missing or not executable: not a candidate.
      return false;
    }
  }

  return {
    os,
    envValue,
    /** `PATH` split into directories. */
    pathDirs: (env: NodeJS.ProcessEnv): string[] =>
      (envValue(env, 'PATH') ?? '').split(paths.delimiter).filter((dir) => dir !== ''),
    /**
     * `PATH` with `dir` after the user's directories, under the name the environment already uses (`Path` on
     * Windows): what the user installed is found first.
     */
    pathAppending(env: NodeJS.ProcessEnv, dir: string): Record<string, string> {
      const name = (isWindows && Object.keys(env).find((k) => k.toUpperCase() === 'PATH')) || 'PATH';
      const current = envValue(env, 'PATH');
      return { [name]: current === undefined || current === '' ? dir : `${current}${paths.delimiter}${dir}` };
    },
    homeDir: (env: NodeJS.ProcessEnv): string | undefined => envValue(env, isWindows ? 'USERPROFILE' : 'HOME'),
    /** A file that can be run (on Windows any existing file: the extension decides, `X_OK` means nothing). */
    isExecutableFile,
    /** The first `name` (with the platform's executable extensions) in `dirs`. */
    findExecutable(name: string, dirs: readonly string[]): string | undefined {
      const names = isWindows ? [`${name}.exe`, `${name}.cmd`] : [name];
      return dirs.flatMap((dir) => names.map((n) => paths.join(dir, n))).find(isExecutableFile);
    },

    /** Git prints `C:/Users/...` on Windows; compared with native paths after this. */
    fromGitPath: (gitPath: string): string => (isWindows ? paths.normalize(gitPath) : gitPath),
    /** Prepended to every git command: worktrees under the data directory easily exceed 260 characters. */
    gitPlatformArgs: isWindows ? (['-c', 'core.longpaths=true'] as const) : ([] as const),

    /**
     * Whether commands run in Git for Windows' bash, which is then also opencode's shell (D72, D73); elsewhere
     * check commands use /bin/sh and opencode the user's own shell.
     */
    shellFromGit: isWindows,
    posixShell: '/bin/sh',
    /** `<root>/mingw64/libexec/git-core` (`git --exec-path`) → `<root>/bin/bash.exe`. */
    gitBashOf: (execPath: string): string => paths.join(paths.normalize(execPath), '..', '..', '..', 'bin', 'bash.exe'),
  };
}

/** The platform this backend runs on; anything else is not supported (17 §1). */
export const host = platformRules(platformSchema.parse(process.platform));
