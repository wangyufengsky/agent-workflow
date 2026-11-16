import type { DeliveryDTO } from '@aw/shared';
import { commitsExist, runGit } from '../git/index.ts';

type Readiness =
  | 'unknown'
  | 'refresh_failed'
  | 'remote_pending'
  | 'remote_closed'
  | 'unverified'
  | 'local_pending'
  | 'ready';
export async function checkMergeReadiness(
  repo: string,
  baseBranch: string,
  delivery: DeliveryDTO | null,
): Promise<{ state: Readiness }> {
  if (delivery === null) return { state: 'unknown' };
  const remote = delivery.remoteStatus;
  if (delivery.remoteError !== null) return { state: 'refresh_failed' };
  if (remote === null) return { state: 'unknown' };
  if (remote.state === 'closed') return { state: 'remote_closed' };
  if (remote.state !== 'merged') return { state: 'remote_pending' };
  // 旧交付缺少当时的 head，平台后的新提交不能证明属于这次交付。
  if (remote.targetBranch !== baseBranch || delivery.diffHead === null || delivery.diffHead !== remote.head) {
    return { state: 'unverified' };
  }
  const fallback = remote.mergeCommit === null && delivery.remoteRef?.provider === 'gitlab';
  const evidence = fallback ? remote.head : remote.mergeCommit;
  if (evidence === null || !/^[0-9a-f]{40,64}$/i.test(evidence)) return { state: 'unverified' };
  await runGit(['rev-parse', '--verify', `refs/heads/${baseBranch}`], { cwd: repo });
  if (!(await commitsExist(repo, [evidence]))) return { state: fallback ? 'unverified' : 'local_pending' };
  const result = await runGit(['merge-base', '--is-ancestor', evidence, `refs/heads/${baseBranch}`], {
    cwd: repo,
    okExitCodes: [0, 1],
  });
  // 无合入提交时，无法区分尚未拉取与平台变基；只有原 head 已在本地基础分支才有充分证据。
  return { state: result.exitCode === 0 ? 'ready' : fallback ? 'unverified' : 'local_pending' };
}
