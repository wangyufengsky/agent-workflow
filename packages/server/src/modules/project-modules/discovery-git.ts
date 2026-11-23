import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, ErrorCode } from '@aw/shared';
import { runGit } from '../git/index.ts';
import { worktreeSources } from '../previews/index.ts';

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

/** 验收发生在节点提交前，跟踪文件和未忽略的新文件均来自任务工作区。 */
export async function taskTree(repoPath: string): Promise<Awaited<ReturnType<typeof baselineTree>>> {
  const { stdout: baseline } = await runGit(['rev-parse', 'HEAD'], { cwd: repoPath });
  const { stdout } = await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoPath,
    verbatim: true,
  });
  const files = new Map<string, BaselineFile>();
  const texts = new Map<string, Promise<string | undefined>>();
  const readSource = worktreeSources(repoPath);
  // 大仓库只检查发现器可能读取的证据，避免遍历生成物和无关资产。
  const paths = [
    ...new Set(
      stdout
        .split('\0')
        .filter((path) =>
          /(?:\.java|\.xml|\.iml|\.gradle(?:\.kts)?|\.md|\.properties|\.ya?ml|compound-services\.json)$/i.test(path),
        ),
    ),
  ];
  for (let offset = 0; offset < paths.length; offset += 64) {
    await Promise.all(
      paths.slice(offset, offset + 64).map(async (path) => {
        try {
          const file = await readSource(path, false);
          if (file !== undefined) files.set(path, { path, bytes: file.size, oid: path });
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== ErrorCode.ValidationFailed) throw error;
          // 配置和启动证据不能通过符号链接读取。
        }
      }),
    );
  }
  function text(path: string): Promise<string | undefined> {
    const file = files.get(path);
    if (file === undefined || file.bytes > MAX_TEXT_BYTES) return Promise.resolve(undefined);
    let pending = texts.get(path);
    if (!pending) {
      pending = readFile(join(repoPath, path), 'utf8').then((content) => {
        if (content.includes('\0')) return undefined;
        file.oid = createHash('sha256').update(content).digest('hex');
        return content;
      });
      texts.set(path, pending);
    }
    return pending;
  }
  async function javaCandidates() {
    const { stdout } = await runGit(
      [
        'grep',
        '--untracked',
        '--exclude-standard',
        '--name-only',
        '-z',
        '-I',
        '-E',
        '-e',
        '(^|[^[:alnum:]_$])main([^[:alnum:]_$]|$)|org\\.junit|junit\\.framework',
        '--',
        '*.java',
      ],
      { cwd: repoPath, okExitCodes: [0, 1], verbatim: true },
    );
    return stdout.split('\0').filter((path) => files.has(path));
  }
  return { baseline, files, text, javaCandidates };
}
