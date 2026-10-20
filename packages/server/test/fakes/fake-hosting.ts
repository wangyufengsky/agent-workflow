import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HostingEndpoints } from '../../src/modules/hosting/index.ts';

export type FakePullRequest = {
  provider: 'github' | 'gitlab';
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
};

/**
 * The few GitHub and GitLab API endpoints the hosting module uses, on a local HTTP server (07 §4: the only external
 * APIs with a fake). GitHub is served under `/github` (Octokit's base URL), GitLab under `/gitlab` (Gitbeaker's host).
 * Only `token` is accepted; `repos` lists the repositories it can see.
 */
export async function createFakeHosting(options: { token: string; repos: string[] }) {
  const pullRequests: FakePullRequest[] = [];
  /** Answers the next pull request with this error instead (e.g. 422: one already exists). */
  let failNext: { status: number; message: string } | undefined;

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    return raw === '' ? {} : JSON.parse(raw);
  };
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const github = /^\/github\/repos\/([^/]+\/[^/]+)(\/pulls)?$/.exec(url.pathname);
      const gitlab = /^\/gitlab\/api\/v4\/projects\/([^/]+)(\/merge_requests)?$/.exec(url.pathname);
      const match = github ?? gitlab;
      if (match === null || match[1] === undefined) return send(res, 404, { message: 'Not Found' });
      const provider = github === null ? 'gitlab' : 'github';
      const token =
        provider === 'github'
          ? req.headers.authorization?.replace(/^(token|Bearer) /, '')
          : req.headers['private-token'];
      if (token !== options.token) return send(res, 401, { message: '401 Unauthorized' });
      const repo = decodeURIComponent(match[1]);
      if (!options.repos.includes(repo)) return send(res, 404, { message: '404 Project Not Found' });
      if (match[2] === undefined) return send(res, 200, { id: 1, full_name: repo, path_with_namespace: repo });
      const body = await readJson(req);
      if (failNext !== undefined) {
        const { status, message } = failNext;
        failNext = undefined;
        return send(res, status, { message });
      }
      const n = pullRequests.length + 1;
      pullRequests.push(
        provider === 'github'
          ? {
              provider,
              repo,
              head: String(body.head),
              base: String(body.base),
              title: String(body.title),
              body: String(body.body),
            }
          : {
              provider,
              repo,
              head: String(body.source_branch),
              base: String(body.target_branch),
              title: String(body.title),
              body: String(body.description),
            },
      );
      return provider === 'github'
        ? send(res, 201, { number: n, html_url: `https://github.example/${repo}/pull/${n}` })
        : send(res, 201, { iid: n, web_url: `https://gitlab.example/${repo}/-/merge_requests/${n}` });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('FakeHosting is not listening on TCP');
  const base = `http://127.0.0.1:${address.port}`;

  return {
    /** Pass as `createTestApp({ hosting })`; a self-hosted GitLab binding uses `gitlabUrl` as its base URL. */
    endpoints: { githubApiUrl: `${base}/github`, gitlabUrl: `${base}/gitlab` } satisfies HostingEndpoints,
    pullRequests,
    failNextPullRequest(status: number, message: string): void {
      failNext = { status, message };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
export type FakeHosting = Awaited<ReturnType<typeof createFakeHosting>>;
