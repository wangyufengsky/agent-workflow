import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runGit } from '../../src/modules/git/index.ts';

const IDENTITY = ['-c', 'user.name=aw-test', '-c', 'user.email=aw-test@example.com'];

export type TestRepo = { path: string; git(...args: string[]): Promise<string> };

/** Real Git repository in a temp dir with one commit on `main` (07 §4). */
export async function createTestRepo(
  options: { files?: Record<string, string>; origin?: string } = {},
): Promise<TestRepo> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'aw-repo-')));
  const git = async (...args: string[]) => (await runGit([...IDENTITY, ...args], { cwd: path })).stdout;
  await git('init', '-q', '-b', 'main');
  for (const [file, content] of Object.entries({ 'README.md': '# test\n', ...options.files })) {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), content);
  }
  await git('add', '-A');
  await git('commit', '-q', '-m', 'init');
  if (options.origin !== undefined) await git('remote', 'add', 'origin', options.origin);
  return { path, git };
}
