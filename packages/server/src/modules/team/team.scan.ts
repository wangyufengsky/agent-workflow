import { AppError, ErrorCode } from '@aw/shared';
import { runGit } from '../git/index.ts';
import { type CommitFacts, parseTeamLog, TEAM_LOG_FORMAT } from './team.parse.ts';

/** Commits read by one `git log`: their SHAs go on its command line. */
export const SCAN_BATCH = 500;

/** The branch's newest commit; a ref that names no commit is a 404 (the user picks it). */
export async function readTip(repo: string, ref: string): Promise<{ sha: string; committedAt: number }> {
  const result = await runGit(['log', '-1', '--format=%H%x00%ct', '--end-of-options', ref, '--'], {
    cwd: repo,
    okExitCodes: [0, 128],
  });
  const [sha, committedAt] = result.stdout.split('\0');
  if (result.exitCode !== 0 || sha === undefined || committedAt === undefined) {
    throw new AppError(ErrorCode.NotFound, `${ref} does not exist`, { object: ref });
  }
  return { sha, committedAt: Number(committedAt) * 1000 };
}

/** The commits `ref` reaches, merges left out (33 §2.2). */
export async function reachableCommits(repo: string, ref: string): Promise<string[]> {
  const { stdout } = await runGit(['rev-list', '--no-merges', '--end-of-options', ref, '--'], { cwd: repo });
  return stdout.split('\n').filter((sha) => sha !== '');
}

/** What 33 §7.1 keeps of these commits, renames followed. */
export async function readCommits(repo: string, shas: readonly string[]): Promise<CommitFacts[]> {
  const { stdout } = await runGit(
    ['log', '--no-walk=unsorted', '-M', `--format=${TEAM_LOG_FORMAT}`, '--numstat', '-z', '--end-of-options', ...shas],
    { cwd: repo },
  );
  return parseTeamLog(stdout);
}

/** Lines of a file in a revision; undefined when the revision has no such file. */
export async function lineCountAt(repo: string, rev: string, path: string): Promise<number | undefined> {
  const result = await runGit(['cat-file', '-p', `${rev}:${path}`], {
    cwd: repo,
    okExitCodes: [0, 128],
    verbatim: true,
  });
  if (result.exitCode !== 0) return undefined;
  const text = result.stdout;
  return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
