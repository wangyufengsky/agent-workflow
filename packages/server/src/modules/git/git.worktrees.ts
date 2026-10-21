import { host } from '../../core/platform.ts';
import { runGit } from './git.cli.ts';

export type GitWorktree = {
  path: string;
  commit: string | null;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
};

/**
 * `git worktree list --porcelain -z`: attributes separated by NUL, worktrees by an empty attribute. The first one is
 * the main worktree.
 */
export function parseWorktreeList(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | undefined;
  for (const field of output.split('\0')) {
    if (field === '') {
      if (current !== undefined) worktrees.push(current);
      current = undefined;
      continue;
    }
    const space = field.indexOf(' ');
    const key = space < 0 ? field : field.slice(0, space);
    const value = space < 0 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      current = { path: value, commit: null, branch: null, locked: false, prunable: false };
      continue;
    }
    if (current === undefined) throw new Error(`git worktree list attribute ${field} outside a worktree`);
    if (key === 'HEAD') current.commit = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  return worktrees;
}

export async function listWorktrees(repo: string): Promise<GitWorktree[]> {
  const { stdout } = await runGit(['worktree', 'list', '--porcelain', '-z'], { cwd: repo });
  // Native paths, comparable with the stored ones (git prints C:/... on Windows, 17 §3.4).
  return parseWorktreeList(stdout).map((worktree) => ({ ...worktree, path: host.fromGitPath(worktree.path) }));
}
