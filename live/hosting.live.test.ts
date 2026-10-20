import { ErrorCode, type HostingProvider, hostingProviderSchema } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { createHostingProvider, PUBLIC_HOSTING } from '../packages/server/src/modules/hosting/index.ts';

/**
 * M4-05 live check against a real GitHub or GitLab repository (07 §6), run by hand with `pnpm test:live`:
 *
 * - `AW_LIVE_HOSTING_PROVIDER` `github` | `gitlab`, `AW_LIVE_HOSTING_REPO` (`owner/name` or the GitLab project path),
 *   `AW_LIVE_HOSTING_TOKEN`, and for a self-hosted GitLab `AW_LIVE_HOSTING_BASE_URL`;
 * - optionally `AW_LIVE_HOSTING_PR_HEAD` / `AW_LIVE_HOSTING_PR_BASE`: two existing branches of that repository, to also
 *   open a pull request (close it afterwards).
 *
 * Without the variables there is nothing to check against and the file reports no tests.
 */
const env = process.env;
const configured = env.AW_LIVE_HOSTING_PROVIDER !== undefined && env.AW_LIVE_HOSTING_TOKEN !== undefined;

describe.runIf(configured)('托管平台（真实仓库）', () => {
  const provider = (): HostingProvider => hostingProviderSchema.parse(env.AW_LIVE_HOSTING_PROVIDER);
  const platform = (token: string) =>
    createHostingProvider(
      { provider: provider(), baseUrl: env.AW_LIVE_HOSTING_BASE_URL ?? null, repo: env.AW_LIVE_HOSTING_REPO ?? '' },
      token,
      PUBLIC_HOSTING,
    );

  it('有效令牌通过验证，无效令牌为 HOSTING_AUTH_FAILED', async () => {
    await platform(env.AW_LIVE_HOSTING_TOKEN ?? '').verify();
    await expect(platform('invalid-token').verify()).rejects.toMatchObject({
      code: ErrorCode.HostingAuthFailed,
    });
  });

  it.runIf(env.AW_LIVE_HOSTING_PR_HEAD !== undefined)('创建 PR / MR 并返回网页地址', async () => {
    const { url } = await platform(env.AW_LIVE_HOSTING_TOKEN ?? '').createPullRequest({
      head: env.AW_LIVE_HOSTING_PR_HEAD ?? '',
      base: env.AW_LIVE_HOSTING_PR_BASE ?? 'main',
      title: 'agent-workflow live test',
      body: 'Opened by live/hosting.live.test.ts; close it.',
    });
    expect(url).toMatch(/^https:\/\//);
  });
});

describe('托管平台（公开仓库，无需令牌）', () => {
  it.each([
    { provider: 'github', repo: 'octocat/Hello-World' },
    { provider: 'gitlab', repo: 'gitlab-org/gitlab' },
  ] as const)('$provider 拒绝无效令牌：HOSTING_AUTH_FAILED', async ({ provider, repo }) => {
    const platform = createHostingProvider({ provider, baseUrl: null, repo }, 'invalid-token', PUBLIC_HOSTING);
    await expect(platform.verify()).rejects.toMatchObject({
      code: ErrorCode.HostingAuthFailed,
      details: { status: 401 },
    });
  });
});
