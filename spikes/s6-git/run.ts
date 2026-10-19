import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const N = 50;
const git = (cwd: string, args: string[]) =>
  execa('git', ['-c', 'user.name=s', '-c', 'user.email=s@s', ...args], { cwd, reject: false });

async function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'aw-s6-'));
  await git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-qm', 'init']);
  return dir;
}

/** Per-repository mutex: serialises operations that change refs or the worktree list. */
function createRepoLock() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(repo: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(repo) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    tails.set(
      repo,
      next.catch(() => undefined),
    );
    return next;
  };
}

async function scenario(useLock: boolean) {
  const repo = await makeRepo();
  const lock = createRepoLock();
  const run = <T>(fn: () => Promise<T>) => (useLock ? lock(repo, fn) : fn());
  const wt = (i: number) => join(repo, '..', `${repo.split('/').pop()}-wt${i}`);

  // 1. create N worktrees concurrently
  const adds = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      run(() => git(repo, ['worktree', 'add', '-q', '-b', `aw/T-${i}`, wt(i), 'main'])),
    ),
  );
  const addErrors = adds.filter((r) => r.exitCode !== 0).map((r) => r.stderr.split('\n')[0]);

  // 2. commit inside every worktree concurrently (no lock: separate index per worktree)
  const commits = await Promise.all(
    adds.map(async (r, i) => {
      if (r.exitCode !== 0) return null;
      writeFileSync(join(wt(i), `f${i}.txt`), `${i}\n`);
      await git(wt(i), ['add', '-A']);
      return git(wt(i), ['commit', '-qm', `T-${i}`]);
    }),
  );
  const commitErrors = commits.filter((r) => r !== null && r.exitCode !== 0).map((r) => r?.stderr.split('\n')[0]);

  // 3. squash-merge every branch into main from the main repo (always serialised: one checkout)
  let mergeErrors = 0;
  for (let i = 0; i < N; i++) {
    if (adds[i]?.exitCode !== 0) continue;
    const m = await git(repo, ['merge', '--squash', `aw/T-${i}`]);
    const c = await git(repo, ['commit', '-qm', `merge T-${i}`]);
    if (m.exitCode !== 0 || c.exitCode !== 0) mergeErrors++;
  }

  // 4. remove worktrees + branches concurrently through the same lock
  const removes = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      run(async () => {
        const a = await git(repo, ['worktree', 'remove', '--force', wt(i)]);
        const b = await git(repo, ['branch', '-D', `aw/T-${i}`]);
        return a.exitCode === 0 && b.exitCode === 0;
      }),
    ),
  );
  const files = (await git(repo, ['ls-files'])).stdout.split('\n').length;
  return {
    useLock,
    addErrors: addErrors.length,
    sampleAddError: addErrors[0] ?? null,
    commitErrors: commitErrors.length,
    mergeErrors,
    removeErrors: removes.filter((x) => !x).length,
    filesOnMain: files,
  };
}

console.log(JSON.stringify([await scenario(false), await scenario(true)], null, 2));
