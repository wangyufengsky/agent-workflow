import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode } from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { createGitHttpServer } from '../../../test/helpers/git-http.ts';
import { runGit } from './git.cli.ts';
import { originEnv } from './git.remote.ts';

it('项目令牌作为请求头随推送到达远端，git 2.31 以前的版本也认（D225）；没有令牌时推送被拒', async () => {
  // A quote in the value: the settings travel shell-quoted.
  const authorization = "Basic YXc6dCdvaw==' x";
  const root = await mkdtemp(join(tmpdir(), 'aw-git-http-'));
  const server = await createGitHttpServer({ root, authorization });
  await runGit(['init', '-q', '--bare', join(root, 'origin.git')], { cwd: root });
  const repo = await createTestRepo({ origin: server.url('origin.git') });
  const network = { config: [], env: {} };
  try {
    await expect(
      runGit(['push', '--quiet', 'origin', 'main'], { cwd: repo.path, env: originEnv(network) }),
    ).rejects.toMatchObject({ code: ErrorCode.GitCommandFailed });

    await runGit(['push', '--quiet', 'origin', 'main'], { cwd: repo.path, env: originEnv(network, authorization) });
    expect((await runGit(['rev-parse', 'main'], { cwd: join(root, 'origin.git') })).stdout).toBe(
      (await repo.git('rev-parse', 'main')).trim(),
    );
  } finally {
    await server.close();
  }
});
