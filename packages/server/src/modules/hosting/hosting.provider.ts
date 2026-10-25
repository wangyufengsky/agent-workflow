import { HostingProvider, type HostingRef } from '@aw/shared';
import { createGithubProvider, githubAccount } from './hosting.github.ts';
import { createGitlabProvider, gitlabAccount } from './hosting.gitlab.ts';

import type { GitHostingProvider } from './hosting.types.ts';

/** API addresses of the public platforms; tests point them at FakeHosting. */
export type HostingEndpoints = { githubApiUrl: string; gitlabUrl: string };

export const PUBLIC_HOSTING: HostingEndpoints = {
  githubApiUrl: 'https://api.github.com',
  gitlabUrl: 'https://gitlab.com',
};

export function createHostingProvider(ref: HostingRef, token: string, endpoints: HostingEndpoints): GitHostingProvider {
  switch (ref.provider) {
    case HostingProvider.Github:
      return createGithubProvider(ref.repo, token, endpoints.githubApiUrl);
    case HostingProvider.Gitlab:
      return createGitlabProvider(ref.repo, token, ref.baseUrl ?? endpoints.gitlabUrl);
  }
}

/** The user name `token` signs in as on the platform at `baseUrl` (null: github.com / gitlab.com). */
export function hostingAccountOf(
  provider: HostingProvider,
  baseUrl: string | null,
  token: string,
  endpoints: HostingEndpoints,
): Promise<string> {
  switch (provider) {
    case HostingProvider.Github:
      return githubAccount(token, endpoints.githubApiUrl);
    case HostingProvider.Gitlab:
      return gitlabAccount(token, baseUrl ?? endpoints.gitlabUrl);
  }
}
