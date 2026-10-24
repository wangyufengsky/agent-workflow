import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './git.cli.ts';

/**
 * Files a first commit of `dir`, which is in no repository, would take: what `git add --all` adds once `extraIgnore`
 * is the root `.gitignore` (null: the directory's own ignore files only). A scratch repository outside `dir` answers
 * it, so `dir` is left untouched.
 */
export async function listUnignoredFiles(dir: string, extraIgnore: string | null): Promise<string[]> {
  const gitDir = await mkdtemp(join(tmpdir(), 'aw-git-init-'));
  try {
    await runGit(['init', '--quiet', '--bare', gitDir], { cwd: dir });
    // info/exclude is read like a root .gitignore, next to the user's global excludes.
    if (extraIgnore !== null) await writeFile(join(gitDir, 'info', 'exclude'), extraIgnore);
    const { stdout } = await runGit(
      ['--git-dir', gitDir, '--work-tree', '.', 'ls-files', '-z', '--others', '--exclude-standard'],
      { cwd: dir },
    );
    return stdout.split('\0').filter((path) => path !== '');
  } finally {
    await rm(gitDir, { recursive: true, force: true });
  }
}

export async function initRepository(dir: string, branch: string): Promise<void> {
  await runGit(['init', '--quiet', '-b', branch], { cwd: dir });
}
