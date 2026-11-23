import { runGit } from '../git/index.ts';

export type BaselineFile = { path: string; oid: string; bytes: number };
const MAX_TEXT_BYTES = 512 * 1024;

export async function baselineTree(repoPath: string, branch: string) {
  const { stdout: baseline } = await runGit(
    ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`],
    { cwd: repoPath },
  );
  const { stdout } = await runGit(['ls-tree', '-rzl', baseline], { cwd: repoPath, verbatim: true });
  const files = new Map<string, BaselineFile>();
  for (const entry of stdout.split('\0')) {
    const tab = entry.indexOf('\t');
    const metadata = /^100(?:644|755) blob ([a-f0-9]+) +(\d+)$/.exec(entry.slice(0, tab));
    if (!metadata?.[1] || tab < 0) continue;
    const path = entry.slice(tab + 1);
    files.set(path, { path, oid: metadata[1], bytes: Number(metadata[2]) });
  }
  const texts = new Map<string, Promise<string | undefined>>();
  async function text(path: string) {
    const file = files.get(path);
    if (!file || file.bytes > MAX_TEXT_BYTES) return undefined;
    let pending = texts.get(file.oid);
    if (!pending) {
      pending = runGit(['cat-file', 'blob', file.oid], { cwd: repoPath, verbatim: true }).then(({ stdout }) =>
        stdout.includes('\0') ? undefined : stdout,
      );
      texts.set(file.oid, pending);
    }
    return pending;
  }
  async function javaCandidates() {
    const { stdout: results } = await runGit(
      [
        'grep',
        '--name-only',
        '-z',
        '-I',
        '-E',
        '-e',
        '(^|[^[:alnum:]_$])main([^[:alnum:]_$]|$)|org\\.junit|junit\\.framework',
        baseline,
        '--',
        '*.java',
      ],
      { cwd: repoPath, okExitCodes: [0, 1], verbatim: true },
    );
    return results
      .split('\0')
      .filter(Boolean)
      .map((entry) => entry.slice(baseline.length + 1));
  }
  return { baseline, files, text, javaCandidates };
}
