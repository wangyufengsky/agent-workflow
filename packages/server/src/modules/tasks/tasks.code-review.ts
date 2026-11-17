import {
  AppError,
  DiffSide,
  ErrorCode,
  NodeKind,
  NodeStatus,
  TASK_CODE_REVIEW_NODE_KEY,
  type TaskCodeReviewInput,
  type TaskCodeReviewReport,
  textLines,
} from '@aw/shared';
import { commitsExist, diffCommits, readFile, runGit } from '../git/index.ts';
import type { Node } from '../nodes/index.ts';

export const isCodeReviewStep = (node: Pick<Node, 'key' | 'kind'>) =>
  node.key === TASK_CODE_REVIEW_NODE_KEY || node.kind === NodeKind.Revise;

export const latestFinishedCodeReview = (nodes: readonly Node[]) =>
  nodes.findLast((node) => isCodeReviewStep(node) && node.status === NodeStatus.Done && node.result !== null);

const safePath = (path: string) =>
  !path.includes('\\') &&
  !path.includes('\0') &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

const invalid = (message: string, details: Record<string, unknown> = {}) =>
  new AppError(ErrorCode.GitReviewFindingsInvalid, message, details);

async function reviewedFileLines(repo: string, location: { commit: string; path: string }): Promise<number> {
  const { commit, path } = location;
  const object = await runGit(['cat-file', '-t', '--end-of-options', `${commit}:${path}`], {
    cwd: repo,
    okExitCodes: [0, 128],
  });
  if (object.exitCode !== 0 || object.stdout !== 'blob') throw invalid('The finding file is absent', { path, commit });
  const file = await readFile(repo, commit, path);
  if (!('content' in file)) throw invalid('The finding needs a readable text file', { path, commit });
  return textLines(file.content).length;
}

export async function resolveTaskCodeReview(repo: string, input: TaskCodeReviewInput): Promise<TaskCodeReviewReport> {
  const { scope } = input;
  const commits = scope.kind === 'diff' ? [scope.from, scope.to] : [scope.commit];
  if (!(await commitsExist(repo, commits))) throw invalid('Use the full commit IDs of the code you reviewed');
  if (scope.kind === 'files' && scope.directory !== '' && !safePath(scope.directory)) {
    throw invalid('Use a repository-relative directory', { directory: scope.directory });
  }
  if (scope.kind === 'files' && scope.directory !== '') {
    const tree = await runGit(['cat-file', '-t', '--end-of-options', `${scope.commit}:${scope.directory}`], {
      cwd: repo,
      okExitCodes: [0, 128],
    });
    if (tree.exitCode !== 0 || tree.stdout !== 'tree') throw invalid('The review directory does not exist');
  }
  const files = scope.kind === 'diff' ? await diffCommits(repo, scope.from, scope.to) : [];
  const findings: TaskCodeReviewReport['findings'] = [];
  const counts = new Map<string, number>();
  for (const finding of input.findings) {
    if (!safePath(finding.path)) throw invalid('Use a repository-relative file', { path: finding.path });
    const old = finding.side === DiffSide.Old;
    let location: { commit: string; path: string };
    if (scope.kind === 'diff') {
      const file = files.find(({ path, oldPath }) => path === finding.path || (old && oldPath === finding.path));
      if (file === undefined) throw invalid('The finding is outside the reviewed diff', { path: finding.path });
      location = { commit: old ? scope.from : scope.to, path: old ? (file.oldPath ?? file.path) : file.path };
    } else {
      if (old || (scope.directory !== '' && !finding.path.startsWith(`${scope.directory}/`))) {
        throw invalid('The finding is outside the reviewed directory', { path: finding.path });
      }
      location = { commit: scope.commit, path: finding.path };
    }
    const key = `${location.commit}:${location.path}`;
    const lineCount = counts.get(key) ?? (await reviewedFileLines(repo, location));
    counts.set(key, lineCount);
    const last = finding.end_line ?? finding.line;
    if (last !== undefined && (finding.line === undefined || last < finding.line || last > lineCount))
      throw invalid('Finding lines are outside the reviewed file', location);
    findings.push({ ...finding, location });
  }
  return { scope, findings };
}
