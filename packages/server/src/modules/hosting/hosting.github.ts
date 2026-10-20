import { Octokit } from '@octokit/rest';
import { basicAuthorization, type GitHostingProvider, hostingError } from './hosting.types.ts';

/** `status` and `response.data` of an Octokit RequestError; anything else is not a platform answer. */
function translate(err: unknown): never {
  if (err instanceof Error && 'status' in err && typeof err.status === 'number') {
    const response = 'response' in err ? err.response : undefined;
    const body = typeof response === 'object' && response !== null && 'data' in response ? response.data : undefined;
    throw hostingError(err.status, body);
  }
  throw err;
}

/** GitHub through Octokit (D08); `repo` is `owner/name`. */
export function createGithubProvider(repo: string, token: string, apiUrl: string): GitHostingProvider {
  const [owner = '', name = ''] = repo.split('/');
  const octokit = new Octokit({ auth: token, baseUrl: apiUrl, log: { debug() {}, info() {}, warn() {}, error() {} } });
  return {
    async verify() {
      await octokit.rest.repos.get({ owner, repo: name }).catch(translate);
    },
    async createPullRequest({ head, base, title, body }) {
      const { data } = await octokit.rest.pulls.create({ owner, repo: name, head, base, title, body }).catch(translate);
      return { url: data.html_url };
    },
    gitAuthorization: () => basicAuthorization('x-access-token', token),
  };
}
