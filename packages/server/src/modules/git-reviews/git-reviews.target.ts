import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  type DiffFile,
  DiffSide,
  ErrorCode,
  FINDING_PROBLEM_HINT,
  FindingProblemCode,
  type GitFindingDTO,
  GitReviewTarget,
  type GitReviewTargetInput,
} from '@aw/shared';
import { diffCommits, diffWorktree, mergeBase, readHead, runGit } from '../git/index.ts';

/** A review's diff, resolved to commits when it starts (27 §4.2): `to` null is the main worktree. */
export type ResolvedTarget = {
  target: GitReviewTarget;
  label: string;
  from: string;
  to: string | null;
  /** The commit's parent compared with (1-based); null for other targets. */
  parent: number | null;
  files: DiffFile[];
};

const short = (sha: string) => sha.slice(0, 7);

async function commitOf(repo: string, ref: string): Promise<string> {
  const { stdout, exitCode } = await runGit(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    {
      cwd: repo,
      okExitCodes: [0, 1],
    },
  );
  if (exitCode !== 0) throw new AppError(ErrorCode.NotFound, `${ref} is not a commit`, { object: ref });
  return stdout.trim();
}

/** The parent a commit is compared with (1-based), or the empty tree for a root commit. */
async function parentOf(repo: string, sha: string, parent: number): Promise<string> {
  const { stdout } = await runGit(['rev-list', '--parents', '-n', '1', sha], { cwd: repo });
  const parents = stdout.trim().split(' ').slice(1);
  if (parents.length === 0) {
    return (await runGit(['hash-object', '-t', 'tree', '/dev/null'], { cwd: repo })).stdout.trim();
  }
  const base = parents[parent - 1];
  if (base === undefined) throw new AppError(ErrorCode.NotFound, `${sha} has no parent ${parent}`, { object: sha });
  return base;
}

export async function resolveTarget(
  repo: string,
  defaultBranch: string,
  input: GitReviewTargetInput,
): Promise<ResolvedTarget> {
  switch (input.kind) {
    case GitReviewTarget.Worktree: {
      const head = await readHead(repo);
      return {
        target: input.kind,
        label: head.branch ?? short(head.commit),
        from: head.commit,
        to: null,
        parent: null,
        files: await diffWorktree(repo, head.commit),
      };
    }
    case GitReviewTarget.Commit: {
      const to = await commitOf(repo, input.sha);
      const from = await parentOf(repo, to, input.parent ?? 1);
      return {
        target: input.kind,
        label: short(to),
        from,
        to,
        parent: input.parent ?? 1,
        files: await diffCommits(repo, from, to),
      };
    }
    case GitReviewTarget.Branch: {
      const to = await commitOf(repo, input.branch);
      const from = await mergeBase(repo, await commitOf(repo, defaultBranch), to);
      return {
        target: input.kind,
        label: input.branch,
        from,
        to,
        parent: null,
        files: await diffCommits(repo, from, to),
      };
    }
    case GitReviewTarget.Range: {
      const to = await commitOf(repo, input.to);
      const from = await mergeBase(repo, await commitOf(repo, input.from), to);
      return {
        target: input.kind,
        label: `${input.from}..${input.to}`,
        from,
        to,
        parent: null,
        files: await diffCommits(repo, from, to),
      };
    }
  }
}

/** How the reviewer reads the diff (its first message, 27 §4.3). */
export function readCommands(target: Pick<ResolvedTarget, 'from' | 'to' | 'files'>): string {
  if (target.to !== null) return `- \`git diff ${target.from} ${target.to}\` (one file: add \`-- <path>\`)`;
  return [
    `- \`git diff ${target.from}\` for tracked files (staged and unstaged changes together)`,
    '- untracked files are new: read them whole with the read tool',
  ].join('\n');
}

/** Lines of a file in a commit, or in the worktree when `rev` is null; undefined when it does not exist there. */
async function lineCount(repo: string, rev: string | null, path: string): Promise<number | undefined> {
  let text: string;
  if (rev === null) {
    const file = join(repo, path);
    if (!existsSync(file)) return undefined;
    text = await readFile(file, 'utf8');
  } else {
    const result = await runGit(['show', `${rev}:${path}`], { cwd: repo, okExitCodes: [0, 128], verbatim: true });
    if (result.exitCode !== 0) return undefined;
    text = result.stdout;
  }
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** `submit_findings` validation (27 §4.4): files of the reviewed diff, lines inside the side they name. */
export async function validateFindings(
  repo: string,
  target: Pick<ResolvedTarget, 'from' | 'to' | 'files'>,
  findings: readonly GitFindingDTO[],
): Promise<void> {
  const paths = new Set(target.files.map((f) => f.path));
  const problems: Array<{ index: number; code: FindingProblemCode; hint: string; lineCount?: number }> = [];
  for (const [index, finding] of findings.entries()) {
    if (!paths.has(finding.path)) {
      problems.push({ index, code: FindingProblemCode.PathNotInDiff, hint: FINDING_PROBLEM_HINT.PATH_NOT_IN_DIFF });
      continue;
    }
    if (finding.line === undefined) continue;
    const rev = finding.side === DiffSide.Old ? target.from : target.to;
    const lines = await lineCount(repo, rev, finding.path);
    const end = finding.end_line ?? finding.line;
    if (lines === undefined || end < finding.line || end > lines) {
      problems.push({
        index,
        code: FindingProblemCode.LineOutOfRange,
        hint: FINDING_PROBLEM_HINT.LINE_OUT_OF_RANGE,
        ...(lines === undefined ? {} : { lineCount: lines }),
      });
    }
  }
  if (problems.length > 0) {
    throw new AppError(ErrorCode.GitReviewFindingsInvalid, 'Some findings do not match the reviewed diff', {
      problems,
      files: [...paths],
    });
  }
}
