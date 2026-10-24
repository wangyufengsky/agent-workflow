import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { GitOperation, type GitStatusDTO } from '@aw/shared';
import { host } from '../../core/platform.ts';
import { runGit } from './git.cli.ts';

/** Branch, upstream distance and changes; the workbench adds what else the main worktree's state needs (27 §6.2). */
export type WorkTreeStatus = Omit<GitStatusDTO, 'operation' | 'identity' | 'fetchedAt'>;

/** Number of space-separated fields before the path in porcelain v2 entries (`1`, `2`, `u`). */
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10 };

/** `git status --porcelain=v2 --branch -z`: `# branch.*` headers, then one entry per path (renames add the old path). */
export function parseStatus(output: string): WorkTreeStatus {
  const status: WorkTreeStatus = {
    branch: null,
    commit: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
  };
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? '';
    if (field === '') continue;
    if (field.startsWith('# ')) {
      const [key, ...rest] = field.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.commit = value === '(initial)' ? null : value;
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match === null) throw new Error(`Unexpected git status branch.ab ${value}`);
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
      continue;
    }
    const kind = field.charAt(0);
    if (kind === '?' || kind === '!') {
      if (kind === '?') status.files.push({ path: field.slice(2), code: '??' });
      continue;
    }
    const before = FIELDS_BEFORE_PATH[kind];
    if (before === undefined) throw new Error(`Unexpected git status entry ${field}`);
    const parts = field.split(' ');
    status.files.push({ path: parts.slice(before).join(' '), code: parts[1] ?? '' });
    // A rename or copy is followed by its original path.
    if (kind === '2') i += 1;
  }
  status.clean = status.files.length === 0;
  return status;
}

/** Branch, upstream distance and changes of the work tree at `cwd`. */
export async function readStatus(cwd: string): Promise<WorkTreeStatus> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '--branch', '-z'], { cwd });
  return parseStatus(stdout);
}

/** Paths with unresolved conflicts during a merge or rebase. */
export async function unmergedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd });
  return stdout.split('\0').filter((p) => p !== '');
}

/** A merge is in progress (`MERGE_HEAD` exists), e.g. the one a conflict resolution step completes. */
export async function hasMergeHead(cwd: string): Promise<boolean> {
  const { exitCode } = await runGit(['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], { cwd, okExitCodes: [0, 1] });
  return exitCode === 0;
}

/** Where git keeps `name` for the worktree at `cwd` (`.git/MERGE_HEAD`, or under `.git/worktrees/<n>/`). */
async function gitPath(cwd: string, name: string): Promise<string> {
  const { stdout } = await runGit(['rev-parse', '--git-path', name], { cwd });
  return resolve(cwd, host.fromGitPath(stdout.trim()));
}

/** Files git leaves while an operation waits for the user, in the order git itself checks them. */
const OPERATION_MARKERS: ReadonlyArray<readonly [string, GitStatusDTO['operation']]> = [
  ['rebase-merge', GitOperation.Rebase],
  ['rebase-apply', GitOperation.Rebase],
  ['MERGE_HEAD', GitOperation.Merge],
  ['CHERRY_PICK_HEAD', GitOperation.CherryPick],
  ['REVERT_HEAD', GitOperation.Revert],
];

/** The operation the user left unfinished in the worktree at `cwd`, if any (27 §5). */
export async function readOperation(cwd: string): Promise<GitStatusDTO['operation']> {
  for (const [name, operation] of OPERATION_MARKERS) {
    if (existsSync(await gitPath(cwd, name))) return operation;
  }
  return null;
}

/** `Name <email> 1700000000 +0800`. */
const IDENT = /^(.*) <(.*)> \d+ [+-]\d{4}$/;

/** Who a commit made at `cwd` would be by; null when git has no identity (it exits 128 rather than guessing). */
export async function readIdentity(cwd: string): Promise<GitStatusDTO['identity']> {
  const { stdout, exitCode } = await runGit(['var', 'GIT_COMMITTER_IDENT'], { cwd, okExitCodes: [0, 128] });
  if (exitCode !== 0) return null;
  const match = IDENT.exec(stdout.trim());
  if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Unexpected git var output ${stdout}`);
  return { name: match[1], email: match[2] };
}

/**
 * The identity the repository's config names (`user.name`, `user.email`), without git's guess from the host name;
 * null when either is unset.
 */
export async function readConfiguredIdentity(cwd: string): Promise<{ name: string; email: string } | null> {
  const [name, email] = await Promise.all(
    ['user.name', 'user.email'].map(async (key) => {
      const { stdout, exitCode } = await runGit(['config', '--get', key], { cwd, okExitCodes: [0, 1] });
      return exitCode === 0 && stdout.trim() !== '' ? stdout.trim() : null;
    }),
  );
  return name == null || email == null ? null : { name, email };
}

/** When any remote was last fetched: the modification time of `FETCH_HEAD`; null if never. */
export async function readFetchedAt(cwd: string): Promise<number | null> {
  const file = await gitPath(cwd, 'FETCH_HEAD');
  return existsSync(file) ? Math.round(statSync(file).mtimeMs) : null;
}
