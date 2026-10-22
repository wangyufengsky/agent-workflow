import { DIFF_FILE_MAX_BYTES, type DiffFile, DiffFileStatus, type FileDiffDTO } from '@aw/shared';
import { runGit } from './git.cli.ts';

const NAME_STATUS: Readonly<Record<string, DiffFile['status']>> = {
  A: DiffFileStatus.Added,
  M: DiffFileStatus.Modified,
  D: DiffFileStatus.Deleted,
  R: DiffFileStatus.Renamed,
  // A file whose type changed (e.g. into a symlink) counts as modified.
  T: DiffFileStatus.Modified,
};

/** `--name-status -z`: `M\0path\0`, renames `R100\0old\0new\0`. */
export function parseNameStatus(output: string): Array<{ path: string; status: DiffFile['status'] }> {
  const fields = output.split('\0');
  const files: Array<{ path: string; status: DiffFile['status'] }> = [];
  for (let i = 0; i < fields.length - 1; ) {
    const code = fields[i] ?? '';
    const letter = code.charAt(0);
    const status = NAME_STATUS[letter];
    if (status === undefined) throw new Error(`Unexpected git name-status ${code}`);
    const path = letter === 'R' || letter === 'C' ? fields[i + 2] : fields[i + 1];
    if (path === undefined) throw new Error(`Truncated git name-status output at ${code}`);
    files.push({ path, status });
    i += letter === 'R' || letter === 'C' ? 3 : 2;
  }
  return files;
}

/** `--numstat -z`: `added\tdeleted\tpath\0`, renames `added\tdeleted\t\0old\0new\0`; binary files show `-`. */
export function parseNumstat(output: string): Map<string, { additions: number | null; deletions: number | null }> {
  const fields = output.split('\0');
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < fields.length - 1; ) {
    const [added, deleted, path] = (fields[i] ?? '').split('\t');
    if (added === undefined || deleted === undefined || path === undefined) {
      throw new Error(`Unexpected git numstat field ${fields[i]}`);
    }
    const renamed = path === '';
    const target = renamed ? fields[i + 2] : path;
    if (target === undefined) throw new Error('Truncated git numstat output');
    const count = (n: string) => (n === '-' ? null : Number(n));
    counts.set(target, { additions: count(added), deletions: count(deleted) });
    i += renamed ? 3 : 1;
  }
  return counts;
}

function merge(
  names: Array<{ path: string; status: DiffFile['status'] }>,
  counts: Map<string, { additions: number | null; deletions: number | null }>,
): DiffFile[] {
  return names.map(({ path, status }) => {
    const count = counts.get(path);
    if (count === undefined) throw new Error(`git numstat has no entry for ${path}`);
    return { path, status, ...count };
  });
}

/** Files changed between two commits. */
export async function diffCommits(cwd: string, from: string, to: string): Promise<DiffFile[]> {
  const [names, counts] = await Promise.all([
    runGit(['diff', '--name-status', '-z', '-M', '--end-of-options', from, to, '--'], { cwd }),
    runGit(['diff', '--numstat', '-z', '-M', '--end-of-options', from, to, '--'], { cwd }),
  ]);
  return merge(parseNameStatus(names.stdout), parseNumstat(counts.stdout));
}

/** Untracked files (respecting .gitignore), as they would be added. */
async function untrackedFiles(cwd: string): Promise<DiffFile[]> {
  const { stdout } = await runGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  const paths = stdout.split('\0').filter((p) => p !== '');
  return Promise.all(
    paths.map(async (path) => {
      // --no-index exits 1 when the files differ, which they always do against /dev/null.
      const { stdout: numstat } = await runGit(['diff', '--no-index', '--numstat', '-z', '--', '/dev/null', path], {
        cwd,
        okExitCodes: [1],
      });
      const [counts] = parseNumstat(numstat).values();
      if (counts === undefined) throw new Error(`git numstat has no entry for untracked ${path}`);
      return { path, status: DiffFileStatus.Added, ...counts };
    }),
  );
}

/** Committed and uncommitted changes of a worktree against a commit, untracked files included. */
export async function diffWorktree(cwd: string, from: string): Promise<DiffFile[]> {
  const [names, counts, untracked] = await Promise.all([
    runGit(['diff', '--name-status', '-z', '-M', from], { cwd }),
    runGit(['diff', '--numstat', '-z', '-M', from], { cwd }),
    untrackedFiles(cwd),
  ]);
  return [...merge(parseNameStatus(names.stdout), parseNumstat(counts.stdout)), ...untracked];
}

/** Staged changes: the index against HEAD (against nothing before the first commit). */
export async function diffStaged(cwd: string): Promise<DiffFile[]> {
  const [names, counts] = await Promise.all([
    runGit(['diff', '--cached', '--name-status', '-z', '-M'], { cwd }),
    runGit(['diff', '--cached', '--numstat', '-z', '-M'], { cwd }),
  ]);
  return merge(parseNameStatus(names.stdout), parseNumstat(counts.stdout));
}

/** Unstaged changes: the worktree against the index, untracked files as additions. */
export async function diffUnstaged(cwd: string): Promise<DiffFile[]> {
  const [names, counts, untracked] = await Promise.all([
    runGit(['diff', '--name-status', '-z'], { cwd }),
    runGit(['diff', '--numstat', '-z'], { cwd }),
    untrackedFiles(cwd),
  ]);
  return [...merge(parseNameStatus(names.stdout), parseNumstat(counts.stdout)), ...untracked];
}

/** Unified diff of one staged file (index against HEAD) or unstaged file (worktree against index, untracked whole). */
export async function diffChangeFile(cwd: string, path: string, staged: boolean): Promise<string> {
  if (staged) return (await runGit(['diff', '--cached', '-M', '--', path], { cwd, verbatim: true })).stdout;
  if (await isUntracked(cwd, path)) return diffAgainstNothing(cwd, path);
  return (await runGit(['diff', '--', path], { cwd, verbatim: true })).stdout;
}

async function isUntracked(cwd: string, path: string): Promise<boolean> {
  const { stdout } = await runGit(['ls-files', '--others', '--exclude-standard', '--', path], { cwd });
  return stdout.trim() !== '';
}

async function diffAgainstNothing(cwd: string, path: string): Promise<string> {
  // --no-index exits 1 when the files differ, which they always do against /dev/null.
  return (await runGit(['diff', '--no-index', '--', '/dev/null', path], { cwd, okExitCodes: [1], verbatim: true }))
    .stdout;
}

/** Unified diff of one file of the worktree against a commit; an untracked file diffs against nothing. */
export async function diffWorktreeFile(cwd: string, from: string, path: string): Promise<string> {
  if (await isUntracked(cwd, path)) return diffAgainstNothing(cwd, path);
  return (await runGit(['diff', '-M', from, '--', path], { cwd, verbatim: true })).stdout;
}

/** Unified diff of one file between two commits. */
export async function diffCommitsFile(cwd: string, from: string, to: string, path: string): Promise<string> {
  return (await runGit(['diff', '-M', '--end-of-options', from, to, '--', path], { cwd, verbatim: true })).stdout;
}

/** A file's diff for the UI: over DIFF_FILE_MAX_BYTES only its size (11 §5). */
export function limitDiff(path: string, diff: string): FileDiffDTO {
  const size = Buffer.byteLength(diff);
  return size > DIFF_FILE_MAX_BYTES ? { path, tooLarge: true, size } : { path, diff };
}
