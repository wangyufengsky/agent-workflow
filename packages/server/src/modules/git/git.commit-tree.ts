import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, ErrorCode } from '@aw/shared';
import { gitProcessEnvironment, runGit } from './git.cli.ts';
import { readRepoRoot } from './git.queries.ts';

/** 用独立索引展开指定提交，不切换引用，也不注册 Git 工作树。 */
export async function withGitCommitTree<T>(
  repo: string,
  commitSha: string,
  read: (root: string) => Promise<T>,
): Promise<T> {
  const missing = () => new AppError(ErrorCode.NotFound, 'Commit not found in the project repository', { commitSha });
  if ((await readRepoRoot(repo)) === undefined) throw missing();
  const env = { ...gitProcessEnvironment(), GIT_NO_REPLACE_OBJECTS: '1' };
  const object = await runGit(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    cwd: repo,
    env,
    input: `${commitSha}\n`,
  });
  if (object.stdout !== `${commitSha} commit`) throw missing();

  const temp = await mkdtemp(join(tmpdir(), 'aw-design-commit-'));
  try {
    const tree = join(temp, 'tree');
    await mkdir(tree);
    const root = await realpath(tree);
    const options = { cwd: repo, env: { ...env, GIT_INDEX_FILE: join(temp, 'index') } };
    const isolated = [
      '-c',
      `core.hooksPath=${join(temp, 'hooks')}`,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.splitIndex=false',
      `--work-tree=${root}`,
    ];
    await runGit([...isolated, 'read-tree', '--no-sparse-checkout', commitSha], options);
    // 保留 Git 的换行和编码转换，但禁用仓库自定义外部过滤进程。
    const filters = await runGit(
      ['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(smudge|process|required)$'],
      { ...options, okExitCodes: [0, 1] },
    );
    const disabled = [...new Set(filters.stdout.split('\0').filter(Boolean))].flatMap((key) => [
      '-c',
      `${key}=${key.endsWith('.required') ? 'false' : ''}`,
    ]);
    await runGit([...disabled, ...isolated, 'checkout-index', '--all', '--ignore-skip-worktree-bits'], options);
    return await read(root);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
