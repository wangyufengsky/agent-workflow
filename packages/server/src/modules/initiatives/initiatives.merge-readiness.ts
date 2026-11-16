import type { DeliveryDTO } from '@aw/shared';
import { commitsExist, runGit } from '../git/index.ts';

type Readiness = 'unknown' | 'remote_pending' | 'remote_closed' | 'local_pending' | 'ready';
export async function checkMergeReadiness(
  repo: string,
  baseBranch: string,
  delivery: DeliveryDTO | null,
): Promise<{ state: Readiness }> {
  if (delivery === null) return { state: 'unknown' };
  const remote = delivery.remoteStatus;
  if (remote === null || delivery.remoteError !== null) return { state: 'unknown' };
  if (remote.state === 'closed') return { state: 'remote_closed' };
  if (remote.state !== 'merged') return { state: 'remote_pending' };
  if (
    remote.targetBranch !== baseBranch ||
    remote.mergeCommit === null ||
    delivery.diffHead === null ||
    delivery.diffHead !== remote.head ||
    !/^[0-9a-f]{40,64}$/i.test(remote.mergeCommit)
  )
    return { state: 'local_pending' };
  await runGit(['rev-parse', '--verify', `refs/heads/${baseBranch}`], { cwd: repo });
  if (!(await commitsExist(repo, [remote.mergeCommit]))) return { state: 'local_pending' };
  const result = await runGit(['merge-base', '--is-ancestor', remote.mergeCommit, `refs/heads/${baseBranch}`], {
    cwd: repo,
    okExitCodes: [0, 1],
  });
  return { state: result.exitCode === 0 ? 'ready' : 'local_pending' };
}
