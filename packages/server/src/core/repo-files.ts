import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const GIT_DIR = '.git';

/** Why a path cannot be read as a file of a repository. */
export const RepoFileProblem = {
  /** Absolute, escaping through `..` or a symbolic link, or in `.git`. */
  Outside: 'outside',
  /** Missing, or not a regular file. */
  Missing: 'missing',
} as const;
export type RepoFileProblem = (typeof RepoFileProblem)[keyof typeof RepoFileProblem];

const isWithin = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const isInGitDir = (root: string, path: string) => relative(root, path).split(sep)[0] === GIT_DIR;

/** `fs` failures that mean the path does not lead to a file; anything else is unexpected. */
function isMissing(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/**
 * Locates a file a user or model names, only if it is a regular file inside the repository (06 §11): relative, not
 * escaping through `..` or a symbolic link, not in `.git` (18 §6.2, 30 §2.1). `relativePath` is `/` separated.
 */
export async function locateRepoFile(
  repoPath: string,
  path: string,
): Promise<{ real: string; relativePath: string } | RepoFileProblem> {
  if (isAbsolute(path)) return RepoFileProblem.Outside;
  const root = await realpath(repoPath);
  const joined = resolve(root, path);
  if (!isWithin(root, joined) || isInGitDir(root, joined)) return RepoFileProblem.Outside;
  let real: string;
  try {
    real = await realpath(joined);
  } catch (err) {
    if (isMissing(err)) return RepoFileProblem.Missing;
    throw err;
  }
  if (!isWithin(root, real) || isInGitDir(root, real)) return RepoFileProblem.Outside;
  if (!(await stat(real)).isFile()) return RepoFileProblem.Missing;
  return { real, relativePath: relative(root, joined).split(sep).join('/') };
}

/**
 * Splits like an editor numbers lines: a final newline does not start another line, and CRLF (a Windows checkout
 * with `core.autocrlf`, 17 §3.4) is a line break like LF.
 */
export function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
