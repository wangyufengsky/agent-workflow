import { runGit } from './git.cli.ts';

export type GitRef = {
  name: string;
  remote: boolean;
  commit: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  subject: string;
  /** Milliseconds. */
  committedAt: number;
};

const BRANCH_FORMAT = [
  '%(HEAD)',
  '%(refname)',
  '%(objectname)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:unix)',
  '%(symref)',
  '%(subject)',
].join('%00');

/** `ahead 1, behind 2` / `ahead 1` / `behind 2` / `gone` / empty. */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)?.[1];
  const behind = /behind (\d+)/.exec(track)?.[1];
  return { ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
}

/** `git for-each-ref --format=<BRANCH_FORMAT>`: one line per ref; symbolic refs (`origin/HEAD`) are left out. */
export function parseBranches(output: string): GitRef[] {
  return output
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      const [head, refname, commit, upstream, track, date, symref, ...subject] = line.split('\0');
      if (refname === undefined || commit === undefined || track === undefined || date === undefined) {
        throw new Error(`Unexpected git for-each-ref line ${line}`);
      }
      if (symref !== '') return [];
      const remote = refname.startsWith('refs/remotes/');
      return [
        {
          name: refname.replace(/^refs\/(heads|remotes)\//, ''),
          remote,
          commit,
          current: head === '*',
          upstream: upstream === '' || upstream === undefined ? null : upstream,
          ...parseTrack(track),
          subject: subject.join('\0'),
          committedAt: Number(date) * 1000,
        },
      ];
    });
}

/** Local and remote-tracking branches. */
export async function listBranches(repo: string): Promise<GitRef[]> {
  const { stdout } = await runGit(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'], {
    cwd: repo,
  });
  return parseBranches(stdout);
}

/** Commits on `ref` that `base` lacks (ahead) and the reverse (behind). */
export async function distance(repo: string, base: string, ref: string): Promise<{ ahead: number; behind: number }> {
  const { stdout } = await runGit(['rev-list', '--left-right', '--count', `${base}...${ref}`], { cwd: repo });
  const [behind, ahead] = stdout.trim().split('\t').map(Number);
  if (ahead === undefined || behind === undefined) throw new Error(`Unexpected git rev-list --count ${stdout}`);
  return { ahead, behind };
}

/**
 * Updates remote-tracking branches of every remote, dropping deleted ones, in `env` (`originEnv`); changes refs (lock
 * the repository).
 */
export async function fetchAll(repo: string, env: NodeJS.ProcessEnv): Promise<void> {
  await runGit(['fetch', '--all', '--prune', '--quiet'], { cwd: repo, env });
}

/** The best common ancestor of two commits. */
export async function mergeBase(repo: string, a: string, b: string): Promise<string> {
  return (await runGit(['merge-base', '--end-of-options', a, b], { cwd: repo })).stdout.trim();
}

/** Whether `ancestor` is reachable from `commit`. */
export async function isAncestor(repo: string, ancestor: string, commit: string): Promise<boolean> {
  const { exitCode } = await runGit(['merge-base', '--is-ancestor', ancestor, commit], {
    cwd: repo,
    okExitCodes: [0, 1],
  });
  return exitCode === 0;
}
