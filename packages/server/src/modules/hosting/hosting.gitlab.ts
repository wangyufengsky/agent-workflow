import { GitbeakerRequestError, Gitlab } from '@gitbeaker/rest';
import { basicAuthorization, type GitHostingProvider, hostingError } from './hosting.types.ts';

async function translate(err: unknown): Promise<never> {
  if (err instanceof GitbeakerRequestError && err.cause !== undefined) {
    throw hostingError(err.cause.response.status, err.cause.description);
  }
  throw err;
}

/** GitLab (gitlab.com or self-hosted at `host`) through Gitbeaker (D08); `repo` is the project path. */
export function createGitlabProvider(repo: string, token: string, host: string): GitHostingProvider {
  const api = new Gitlab({ host, token });
  return {
    async verify() {
      await api.Projects.show(repo).catch(translate);
    },
    async createPullRequest({ head, base, title, body }) {
      const request = await api.MergeRequests.create(repo, head, base, title, { description: body }).catch(translate);
      return { url: request.web_url };
    },
    gitAuthorization: () => basicAuthorization('oauth2', token),
  };
}
