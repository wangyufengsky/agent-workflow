import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import {
  AppError,
  DESIGN_SCAN_MAX_FILE_BYTES,
  DesignEvidenceClass,
  type DiffFile,
  DiffFileStatus,
  DiffSide,
  designRelativePathSchema,
  ErrorCode,
  GitReviewEvidenceState,
  type SubmitFindingsInput,
} from '@aw/shared';
import { linesOf, locateRepoFile } from '../../core/repo-files.ts';
import { designExclusion } from '../designs/index.ts';
import {
  diffCommitsFile,
  diffWorktree,
  diffWorktreeFile,
  limitDiff,
  readFile as readGitFile,
  runGit,
} from '../git/index.ts';
import type { Review } from './git-reviews.repo.ts';

type EvidenceTarget = Pick<Review, 'fromSha' | 'toSha' | 'files'>;

function allowed(path: string, exclusions: readonly string[]): boolean {
  return (
    designRelativePathSchema.safeParse(path).success &&
    !path.split('/').some((segment) => segment.toLowerCase() === '.git') &&
    designExclusion(path, exclusions) === undefined
  );
}

async function worktreeText(root: string, path: string, exclusions: readonly string[]) {
  const located = await locateRepoFile(root, path);
  if (typeof located === 'string' || !allowed(relative(root, located.real).split(sep).join('/'), exclusions))
    return null;
  if ((await stat(located.real)).size > DESIGN_SCAN_MAX_FILE_BYTES) return null;
  const bytes = await readFile(located.real);
  if (bytes.includes(0) || !isUtf8(bytes)) return null;
  return { hash: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString('utf8') };
}

export async function recordWorktreeFiles(repo: string, files: DiffFile[], exclusions: readonly string[]) {
  const root = await realpath(repo);
  const frozen: Review['files'] = [];
  for (const file of files) {
    const source =
      file.status !== DiffFileStatus.Deleted && allowed(file.path, exclusions)
        ? await worktreeText(root, file.path, exclusions)
        : null;
    frozen.push(source === null ? file : { ...file, worktreeHash: source.hash });
  }
  return frozen;
}

/** 只在打开工作区审查详情时核对。历史报告和跳过的文件可能只有路径与行数摘要。 */
export async function worktreeChanged(repo: string, target: EvidenceTarget, exclusions: readonly string[]) {
  if (!(await stat(repo, { throwIfNoEntry: false }))?.isDirectory()) return undefined;
  const head = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: repo, okExitCodes: [0, 128] });
  if (head.exitCode !== 0) return undefined;
  if (head.stdout.trim() !== target.fromSha) return true;
  const files = await diffWorktree(repo, target.fromSha);
  if (files.length !== target.files.length) return true;
  const current = new Map(files.map((file) => [file.path, file]));
  const root = await realpath(repo);
  let complete = true;
  for (const file of target.files) {
    const now = current.get(file.path);
    if (
      !now ||
      now.status !== file.status ||
      now.oldPath !== file.oldPath ||
      now.additions !== file.additions ||
      now.deletions !== file.deletions
    )
      return true;
    if (file.worktreeHash !== undefined) {
      if ((await worktreeText(root, file.path, exclusions))?.hash !== file.worktreeHash) return true;
    } else if (file.status !== DiffFileStatus.Deleted) complete = false;
  }
  return complete ? false : undefined;
}

async function committedText(repo: string, sha: string, path: string): Promise<string | null> {
  const entry = await runGit(['--literal-pathspecs', 'ls-tree', '-z', '-l', '--end-of-options', sha, '--', path], {
    cwd: repo,
    okExitCodes: [0, 128],
  });
  // Git 的符号链接本身也是 blob；只有普通文件可以作为源码证据。
  const match = /^100(?:644|755) blob [0-9a-f]+\s+(\d+)\t/.exec(entry.stdout);
  if (!match || Number(match[1]) > DESIGN_SCAN_MAX_FILE_BYTES) return null;
  const file = await readGitFile(repo, sha, path);
  return 'content' in file ? file.content : null;
}

function changedFile(target: EvidenceTarget, path: string) {
  return target.files.find((file) => file.path === path) ?? target.files.find((file) => file.oldPath === path);
}

async function sourceAt(
  repo: string,
  target: EvidenceTarget,
  path: string,
  side: DiffSide,
  exclusions: readonly string[],
) {
  const file = changedFile(target, path);
  const sourcePath = side === DiffSide.Old ? (file?.oldPath ?? path) : (file?.path ?? path);
  const unavailable = { state: GitReviewEvidenceState.Unavailable, path: sourcePath, content: null };
  if (!allowed(sourcePath, exclusions)) return unavailable;
  if (side === DiffSide.Old || target.toSha !== null || file === undefined) {
    const sha = side === DiffSide.Old ? target.fromSha : (target.toSha ?? target.fromSha);
    const content = await committedText(repo, sha, sourcePath);
    return content === null ? unavailable : { state: GitReviewEvidenceState.Available, path: sourcePath, content };
  }
  if (file.worktreeHash === undefined) return unavailable;
  const source = await worktreeText(await realpath(repo), sourcePath, exclusions);
  if (source?.hash !== file.worktreeHash) return { ...unavailable, state: GitReviewEvidenceState.Changed };
  return { state: GitReviewEvidenceState.Available, path: sourcePath, content: source.content };
}

export async function readReviewEvidence(
  repo: string,
  review: Review,
  path: string,
  side: DiffSide,
  exclusions: readonly string[],
) {
  const reported = review.findings.some((f) => f.path === path) || review.impacts.some((i) => i.evidencePath === path);
  if (!reported) throw new AppError(ErrorCode.NotFound, 'Evidence is not part of this review', { path, side });
  const source = await sourceAt(repo, review, path, side, exclusions);
  const file = changedFile(review, path);
  if (
    source.content === null ||
    file === undefined ||
    !allowed(file.path, exclusions) ||
    (file.oldPath && !allowed(file.oldPath, exclusions))
  ) {
    return { ...source, patch: null };
  }
  if (review.toSha === null) {
    // 旧侧只能展示不可变基线；新侧在读取补丁后再次核对，工作区可能已被编辑。
    if (side === DiffSide.Old) return { ...source, patch: null };
    const patch = await diffWorktreeFile(repo, review.fromSha, file.path, file.oldPath);
    const checked = await sourceAt(repo, review, path, side, exclusions);
    return { ...checked, patch: checked.content === null ? null : limitDiff(path, patch) };
  }
  const patch = await diffCommitsFile(repo, review.fromSha, review.toSha, file.path, file.oldPath);
  return { ...source, patch: limitDiff(path, patch) };
}

export async function validateReviewImpacts(
  repo: string,
  target: EvidenceTarget,
  input: SubmitFindingsInput,
  exclusions: readonly string[],
) {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const ids = new Set<string>();
  const sources = new Map<string, number>();
  for (const [index, impact] of (input.impacts ?? []).entries()) {
    if (ids.has(impact.id)) issues.push({ path: ['impacts', index, 'id'], message: 'Use a unique impact id' });
    ids.add(impact.id);
    if (impact.relPath !== undefined && !allowed(impact.relPath, exclusions)) {
      issues.push({ path: ['impacts', index, 'relPath'], message: 'Use a non-excluded repository-relative path' });
    }
    if (impact.evidencePath !== undefined && !allowed(impact.evidencePath, exclusions)) {
      issues.push({ path: ['impacts', index, 'evidencePath'], message: 'Use a non-excluded repository-relative path' });
      continue;
    }
    if (impact.evidenceClass !== DesignEvidenceClass.Static) continue;
    const { evidencePath, lineStart, lineEnd } = impact;
    if (evidencePath === undefined || lineStart === undefined || lineEnd === undefined) {
      issues.push({ path: ['impacts', index], message: 'Static evidence needs a source path, start and end line' });
      continue;
    }
    const side = impact.side ?? DiffSide.New;
    const key = `${side}:${evidencePath}`;
    let count = sources.get(key);
    if (count === undefined) {
      const source = await sourceAt(repo, target, evidencePath, side, exclusions);
      count = source.content === null ? -1 : linesOf(source.content).length;
      sources.set(key, count);
    }
    if (lineEnd < lineStart || lineEnd > count)
      issues.push({
        path: ['impacts', index, 'lineEnd'],
        message: 'Evidence must be inside a readable text file on the reviewed side',
      });
  }
  const changedPaths = new Set(
    target.files.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path])),
  );
  for (const [index, impact] of (input.impacts ?? []).entries()) {
    if (impact.sourcePaths?.some((path) => !changedPaths.has(path) || !allowed(path, exclusions))) {
      issues.push({
        path: ['impacts', index, 'sourcePaths'],
        message: 'Use non-excluded changed paths from this review',
      });
    }
    if (impact.viaImpactIds?.some((id) => id === impact.id || !ids.has(id))) {
      issues.push({ path: ['impacts', index, 'viaImpactIds'], message: 'Use a different impact from this report' });
    }
  }
  for (const [index, finding] of input.findings.entries()) {
    if (finding.affectedImpactIds?.some((id) => !ids.has(id)))
      issues.push({ path: ['findings', index, 'affectedImpactIds'], message: 'Reference impacts in this report' });
  }
  if (issues.length) throw new AppError(ErrorCode.ValidationFailed, 'Invalid review impact evidence', { issues });
}
