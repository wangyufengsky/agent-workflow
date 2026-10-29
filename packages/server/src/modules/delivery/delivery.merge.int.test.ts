import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryStrategy, ErrorCode } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createRepoLocks } from '../git/index.ts';
import { checkDeliverable, mergeLocally } from './delivery.merge.ts';

describe('本地合并在仓库锁内复查目标分支所在的工作区（09 §7）', () => {
  it('检查通过之后才暂存的文件：拒绝合并，不把它提交进交付，用户的暂存区原样保留', async () => {
    const repo = await createTestRepo();
    const worktreePath = join(await realpath(await mkdtemp(join(tmpdir(), 'aw-task-'))), 'T-1');
    await repo.git('worktree', 'add', '-q', '-b', 'aw/T-1', worktreePath);
    await writeFile(join(worktreePath, 'feature.txt'), 'feature\n');
    await repo.git('-C', worktreePath, 'add', 'feature.txt');
    await repo.git('-C', worktreePath, 'commit', '-q', '-m', 'feature');
    await checkDeliverable({ repoPath: repo.path, worktreePath, targetBranch: 'main', checkTargetWorktree: true });

    // Between the check and the merge, the user stages unrelated work where main is checked out.
    await writeFile(join(repo.path, 'user-work.txt'), 'mine\n');
    await repo.git('add', 'user-work.txt');
    const merge = mergeLocally(createRepoLocks(), {
      repoPath: repo.path,
      worktreePath,
      branch: 'aw/T-1',
      targetBranch: 'main',
      strategy: DeliveryStrategy.Squash,
      message: 'T-1 feature',
      identity: null,
    });

    await expect(merge).rejects.toMatchObject({
      code: ErrorCode.DeliveryTargetDirty,
      details: { branch: 'main', files: ['user-work.txt'] },
    });
    expect(await repo.git('log', '-1', '--format=%s', 'main')).toBe('init');
    expect(await repo.git('diff', '--cached', '--name-only')).toBe('user-work.txt');
  });
});
