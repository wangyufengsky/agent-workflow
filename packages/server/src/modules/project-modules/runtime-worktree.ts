import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { AppError, ErrorCode } from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import { listWorktrees, type RepoLocks, runGit } from '../git/index.ts';

async function removeTrialWorktree(scratch: string, source: string, locks: RepoLocks): Promise<void> {
  const path = join(scratch, 'checkout');
  await locks.run(source, async () => {
    if ((await listWorktrees(source)).some((entry) => entry.path === path))
      await runGit(['worktree', 'remove', '--force', path], { cwd: source });
    await rm(scratch, { recursive: true, force: true });
  });
}

/** A detached trial worktree never creates a task branch or writes to the user's checkout. */
export async function createRuntimeWorktree(root: string, repoPath: string, baseline: string, locks: RepoLocks) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(baseline))
    throw new AppError(ErrorCode.ValidationFailed, 'A module trial needs a full commit ID');
  const source = await realpath(repoPath);
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(await realpath(root), 'trial-'));
  const path = join(scratch, 'checkout');
  try {
    await writeFile(join(scratch, 'repository'), source, { encoding: 'utf8', flag: 'wx' });
    await locks.run(source, () => runGit(['worktree', 'add', '--detach', path, baseline], { cwd: source }));
  } catch (error) {
    await removeTrialWorktree(scratch, source, locks);
    throw error;
  }
  return { path, baseCommit: baseline.toLowerCase(), remove: () => removeTrialWorktree(scratch, source, locks) };
}

export async function recoverRuntimeWorktrees(root: string, locks: RepoLocks, log: Logger): Promise<void> {
  await mkdir(root, { recursive: true });
  const directory = await realpath(root);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^trial-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const scratch = join(directory, entry.name);
    try {
      const repo = await readFile(join(scratch, 'repository'), 'utf8');
      if (!isAbsolute(repo)) throw new Error('Invalid module runtime checkout metadata');
      await removeTrialWorktree(scratch, repo, locks);
    } catch (error) {
      log.warn({ err: error, scratch }, 'module runtime checkout recovery failed');
    }
  }
}
