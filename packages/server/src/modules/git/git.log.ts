import type { GitCommitDetailDTO, GitCommitDTO } from '@aw/shared';
import { runGit } from './git.cli.ts';
import { diffCommits } from './git.diff.ts';

/** Fields separated by NUL, commits terminated by RS (bodies may contain newlines, never NUL or RS). */
const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b%x1e';

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

/** Up to `limit` commits reachable from `ref`, newest first, after skipping `skip`. */
export async function readLog(repo: string, ref: string, limit: number, skip: number): Promise<GitCommitDTO[]> {
  const { stdout } = await runGit(
    ['log', `--format=${LOG_FORMAT}`, `--max-count=${limit}`, `--skip=${skip}`, '--end-of-options', ref, '--'],
    { cwd: repo },
  );
  return parseLog(stdout);
}

/** The id of the empty tree in this repository's hash format, the base of a root commit's diff. */
async function emptyTree(repo: string): Promise<string> {
  return (await runGit(['hash-object', '-t', 'tree', '/dev/null'], { cwd: repo })).stdout.trim();
}

/** One commit and the files it changed against its first parent. */
export async function readCommit(repo: string, sha: string): Promise<GitCommitDetailDTO> {
  const [commit] = await readLog(repo, sha, 1, 0);
  if (commit === undefined) throw new Error(`git log returned no commit for ${sha}`);
  const parent = commit.parents[0] ?? (await emptyTree(repo));
  return { ...commit, files: await diffCommits(repo, parent, commit.sha) };
}
