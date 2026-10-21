import path from 'node:path';
import { Platform, platformSchema } from '@aw/shared';
import { execa } from 'execa';

/** The commands the backend may need to stop: a hosted `opencode serve` or a check command (D68). */
export type Stoppable = { pid?: number | undefined };

/**
 * Everything that differs between the operating systems the backend runs on (17 §2, D66). Built per platform so
 * the Windows rules can be unit-tested anywhere; the rest of the backend uses `host`.
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

  return {
    os,
    envValue,
    /** `PATH` split into directories. */
    pathDirs: (env: NodeJS.ProcessEnv): string[] =>
      (envValue(env, 'PATH') ?? '').split(paths.delimiter).filter((dir) => dir !== ''),
    homeDir: (env: NodeJS.ProcessEnv): string | undefined => envValue(env, isWindows ? 'USERPROFILE' : 'HOME'),
    /** File names under which a command can be run: npm installs only a `.cmd` launcher on Windows (D70). */
    executableNames: (name: string): string[] => (isWindows ? [`${name}.exe`, `${name}.cmd`] : [name]),

    /**
     * How to start `file`: Node refuses to spawn `.cmd` files directly (CVE-2024-27980), so they run through
     * `cmd.exe`. Arguments are literals written by this app and contain no cmd metacharacters.
     */
    commandFor(
      file: string,
      args: readonly string[],
      env: NodeJS.ProcessEnv,
    ): { file: string; args: string[]; windowsVerbatimArguments: boolean } {
      if (!isWindows || !/\.(cmd|bat)$/i.test(file)) return { file, args: [...args], windowsVerbatimArguments: false };
      const comspec = envValue(env, 'ComSpec');
      if (comspec === undefined) throw new Error('ComSpec is not set');
      return {
        file: comspec,
        args: ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`],
        windowsVerbatimArguments: true,
      };
    },

    /** Git prints `C:/Users/...` on Windows; compared with native paths after this. */
    fromGitPath: (gitPath: string): string => (isWindows ? paths.normalize(gitPath) : gitPath),
    /** Prepended to every git command: worktrees under the data directory easily exceed 260 characters. */
    gitPlatformArgs: isWindows ? (['-c', 'core.longpaths=true'] as const) : ([] as const),

    /**
     * Whether commands run in Git for Windows' bash, which is then also opencode's shell (D67, D68); elsewhere
     * check commands use /bin/sh and opencode the user's own shell.
     */
    shellFromGit: isWindows,
    posixShell: '/bin/sh',
    /** `<root>/mingw64/libexec/git-core` (`git --exec-path`) → `<root>/bin/bash.exe`. */
    gitBashOf: (execPath: string): string => paths.join(paths.normalize(execPath), '..', '..', '..', 'bin', 'bash.exe'),

    /**
     * Spawn options of a child that `killProcessTree` must be able to stop with everything it starts: on POSIX it
     * leads its own process group. (On Windows `detached` would open a console window; the tree is found by pid.)
     */
    treeSpawnOptions: { detached: !isWindows },

    /**
     * Stops a child spawned with `treeSpawnOptions` and everything it started (D68): a shell that is ended alone
     * leaves its commands running, holding the output pipes and worktree files. POSIX signals the process group;
     * Windows has no signals and ends the tree with taskkill.
     */
    async killProcessTree(child: Stoppable): Promise<void> {
      if (child.pid === undefined) return;
      if (!isWindows) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (err) {
          // ESRCH: the group had already exited, which is what stopping wants.
          if (!(err instanceof Error && 'code' in err && err.code === 'ESRCH')) throw err;
        }
        return;
      }
      const root = envValue(process.env, 'SystemRoot');
      if (root === undefined) throw new Error('SystemRoot is not set');
      const args = ['/pid', String(child.pid), '/T', '/F'];
      const result = await execa(paths.join(root, 'System32', 'taskkill.exe'), args, { reject: false });
      // 128: the process had already exited, which is what stopping wants.
      if (result.exitCode !== 0 && result.exitCode !== 128) {
        throw new Error(`taskkill ${args.join(' ')} failed (${result.exitCode}): ${result.stderr}`);
      }
    },
  };
}

/** The platform this backend runs on; anything else is not supported (17 §1). */
export const host = platformRules(platformSchema.parse(process.platform));
