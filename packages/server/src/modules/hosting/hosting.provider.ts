import { HostingProvider, type HostingRef } from '@aw/shared';
import { createGithubProvider } from './hosting.github.ts';
import { createGitlabProvider } from './hosting.gitlab.ts';

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
