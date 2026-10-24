import { AppError, ErrorCode, type GitCommitDetailDTO, type GitCommitDTO } from '@aw/shared';
import { runGit } from './git.cli.ts';
import { diffCommits } from './git.diff.ts';

/** Fields separated by NUL, commits terminated by RS (bodies may contain newlines, never NUL or RS). */
const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e';
/** The committer of one commit (`git show -s`). */
const COMMITTER_FORMAT = '%cn%x00%ce%x00%ct';

/**
 * Which commits a log shows besides the ref: the author (name or email), text in the message, and the ref's
 * first-parent history committed before a time (ms).
 */
export type LogFilter = { author?: string | undefined; search?: string | undefined; before?: number | undefined };

/** The revision options that keep to a ref's own (first-parent) history committed before `before` (ms). */
export const beforeArgs = (before: number) => ['--first-parent', `--before=@${Math.floor(before / 1000)}`];

/** `git log --format=<LOG_FORMAT>`; git puts a newline between commits. */
export function parseLog(output: string): GitCommitDTO[] {
  return output
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record !== '')
    .map((record) => {
      const [sha, parents, authorName, authorEmail, authoredAt, subject, body] = record.split('\0');
      if (
        sha === undefined ||
        parents === undefined ||
        authorName === undefined ||
        authorEmail === undefined ||
        authoredAt === undefined ||
        subject === undefined ||
        body === undefined
      ) {
        throw new Error(`Unexpected git log record ${record}`);
      }
      return {
        sha,
        parents: parents === '' ? [] : parents.split(' '),
        authorName,
        authorEmail,
        authoredAt: Number(authoredAt) * 1000,
        subject,
        body: body.trimEnd(),
      };
    });
}

/** Up to `limit` commits reachable from `ref`, newest first, after skipping `skip`; fixed-string, case-blind filters. */
export async function readLog(
  repo: string,
  ref: string,
  limit: number,
  skip: number,
  filter: LogFilter = {},
): Promise<GitCommitDTO[]> {
  const filters = [
    ...(filter.author === undefined ? [] : [`--author=${filter.author}`]),
    ...(filter.search === undefined ? [] : [`--grep=${filter.search}`]),
  ];
  const { stdout } = await runGit(
    [
      'log',
      `--format=${LOG_FORMAT}`,
      `--max-count=${limit}`,
      `--skip=${skip}`,
      ...(filters.length === 0 ? [] : ['--fixed-strings', '--regexp-ignore-case', ...filters]),
      ...(filter.before === undefined ? [] : beforeArgs(filter.before)),
      '--end-of-options',
      ref,
      '--',
    ],
    { cwd: repo },
  );
  return parseLog(stdout);
}

/** Up to `limit` commits of revision arguments (`a..b`, `b --not --remotes=origin`), newest first. */
export async function readRevisions(
  repo: string,
  revisions: readonly string[],
  limit: number,
): Promise<GitCommitDTO[]> {
  const { stdout } = await runGit(['log', `--format=${LOG_FORMAT}`, `--max-count=${limit}`, ...revisions, '--'], {
    cwd: repo,
  });
  return parseLog(stdout);
}

/** The id of the empty tree in this repository's hash format, the base of a root commit's diff. */
async function emptyTree(repo: string): Promise<string> {
  return (await runGit(['hash-object', '-t', 'tree', '/dev/null'], { cwd: repo })).stdout.trim();
}

/**
 * One commit, the files it changed against parent number `parent` (1-based; a merge commit has two) or the empty
 * tree for a root commit, and the local branches containing it.
 */
export async function readCommit(repo: string, sha: string, parent = 1): Promise<GitCommitDetailDTO> {
  const [commit] = await readLog(repo, sha, 1, 0);
  if (commit === undefined) throw new Error(`git log returned no commit for ${sha}`);
  const base = commit.parents[parent - 1] ?? (commit.parents.length === 0 ? await emptyTree(repo) : undefined);
  if (base === undefined) {
    throw new AppError(ErrorCode.NotFound, `Commit ${sha} has no parent ${parent}`, { object: `${sha}^${parent}` });
  }
  const [committer, branches, files] = await Promise.all([
    runGit(['show', '-s', `--format=${COMMITTER_FORMAT}`, commit.sha], { cwd: repo }),
    runGit(['for-each-ref', '--format=%(refname:short)', '--contains', commit.sha, 'refs/heads'], { cwd: repo }),
    diffCommits(repo, base, commit.sha),
  ]);
  const [committerName, committerEmail, committedAt] = committer.stdout.split('\0');
  if (committerName === undefined || committerEmail === undefined || committedAt === undefined) {
    throw new Error(`Unexpected git show committer ${committer.stdout}`);
  }
  return {
    ...commit,
    committerName,
    committerEmail,
    committedAt: Number(committedAt) * 1000,
    base,
    files,
    branches: branches.stdout.split('\n').filter((b) => b !== ''),
  };
}
