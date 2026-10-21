import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HostingEndpoints } from '../../src/modules/hosting/index.ts';

export type FakeMessage = { author: string; body: string; createdAt: string };
export type FakeReviewThread = { path: string; line: number; resolved: boolean; messages: FakeMessage[] };

export type FakePullRequest = {
  provider: 'github' | 'gitlab';
  repo: string;
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  open: boolean;
  /** Review threads (GitHub) / resolvable discussions (GitLab). */
  threads: FakeReviewThread[];
  /** Conversation comments (GitHub) / plain notes (GitLab). */
  comments: FakeMessage[];
};

/** The input of a seeded comment: `createdAt` defaults to now. */
export type FakeMessageInput = { author: string; body: string; createdAt?: string };

const message = (m: FakeMessageInput): FakeMessage => ({ ...m, createdAt: m.createdAt ?? new Date().toISOString() });

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
  const webUrl = (pr: FakePullRequest) =>
    pr.provider === 'github'
      ? `https://github.example/${pr.repo}/pull/${pr.number}`
      : `https://gitlab.example/${pr.repo}/-/merge_requests/${pr.number}`;
  const find = (provider: FakePullRequest['provider'], repo: string, number: number) =>
    pullRequests.find((p) => p.provider === provider && p.repo === repo && p.number === number);

  async function createPullRequest(
    res: ServerResponse,
    provider: FakePullRequest['provider'],
    repo: string,
    req: IncomingMessage,
  ) {
    const body = await readJson(req);
    if (failNext !== undefined) {
      const { status, message } = failNext;
      failNext = undefined;
      return send(res, status, { message });
    }
    const github = provider === 'github';
    const pr: FakePullRequest = {
      provider,
      repo,
      number: pullRequests.length + 1,
      head: String(github ? body.head : body.source_branch),
      base: String(github ? body.base : body.target_branch),
      title: String(body.title),
      body: String(github ? body.body : body.description),
      open: true,
      threads: [],
      comments: [],
    };
    pullRequests.push(pr);
    return github
      ? send(res, 201, { number: pr.number, html_url: webUrl(pr) })
      : send(res, 201, { iid: pr.number, web_url: webUrl(pr) });
  }

  /** The GraphQL query of `listReviewComments`, answered from the pull request's threads and comments. */
  function githubReview(pr: FakePullRequest) {
    const url = webUrl(pr);
    const author = (m: FakeMessage) => ({ author: { login: m.author }, body: m.body, createdAt: m.createdAt });
    return {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: pr.threads.map((t, i) => ({
                id: `PRRT_${pr.number}_${i}`,
                isResolved: t.resolved,
                path: t.path,
                line: t.line,
                originalLine: t.line,
                comments: { nodes: t.messages.map((m, j) => ({ ...author(m), url: `${url}#discussion_r${i}${j}` })) },
              })),
            },
            comments: {
              nodes: pr.comments.map((m, i) => ({
                id: `IC_${pr.number}_${i}`,
                ...author(m),
                url: `${url}#issuecomment-${i}`,
              })),
            },
            reviews: { nodes: [] },
          },
        },
      },
    };
  }

  function gitlabDiscussions(pr: FakePullRequest) {
    const note = (m: FakeMessage, id: number, extra: Record<string, unknown>) => ({
      id,
      body: m.body,
      author: { username: m.author },
      created_at: m.createdAt,
      system: false,
      ...extra,
    });
    return [
      ...pr.threads.map((t, i) => ({
        id: `thread${i}`,
        individual_note: false,
        notes: t.messages.map((m, j) =>
          note(m, 100 * i + j, {
            resolvable: true,
            resolved: t.resolved,
            position: { new_path: t.path, new_line: t.line },
          }),
        ),
      })),
      ...pr.comments.map((m, i) => ({
        id: `note${i}`,
        individual_note: true,
        notes: [note(m, 10_000 + i, { resolvable: false })],
      })),
    ];
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const graphql = url.pathname === '/github/graphql';
      const github = /^\/github\/repos\/([^/]+\/[^/]+)(\/pulls)?$/.exec(url.pathname);
      const gitlab = /^\/gitlab\/api\/v4\/projects\/([^/]+)(\/merge_requests(?:\/(\d+)\/discussions)?)?$/.exec(
        url.pathname,
      );
      const match = github ?? gitlab;
      if (!graphql && (match === null || match[1] === undefined)) return send(res, 404, { message: 'Not Found' });
      const provider = github === null && !graphql ? 'gitlab' : 'github';
      const token =
        provider === 'github'
          ? req.headers.authorization?.replace(/^(token|Bearer) /, '')
          : req.headers['private-token'];
      if (token !== options.token) return send(res, 401, { message: '401 Unauthorized' });

      if (graphql) {
        const { variables } = (await readJson(req)) as { variables: { owner: string; name: string; number: number } };
        const pr = find('github', `${variables.owner}/${variables.name}`, variables.number);
        if (pr === undefined) return send(res, 200, { data: null, errors: [{ type: 'NOT_FOUND', message: 'No PR' }] });
        return send(res, 200, githubReview(pr));
      }
      const repo = decodeURIComponent(match?.[1] ?? '');
      if (!options.repos.includes(repo)) return send(res, 404, { message: '404 Project Not Found' });
      if (match?.[2] === undefined) return send(res, 200, { id: 1, full_name: repo, path_with_namespace: repo });
      if (req.method === 'POST') return createPullRequest(res, provider, repo, req);

      if (gitlab?.[3] !== undefined) {
        const pr = find('gitlab', repo, Number(gitlab[3]));
        return pr === undefined ? send(res, 404, { message: '404 Not found' }) : send(res, 200, gitlabDiscussions(pr));
      }
      // The open pull requests from a branch: GitHub `head=owner:branch&state=open`, GitLab `source_branch=…`.
      const head =
        provider === 'github' ? url.searchParams.get('head')?.split(':')[1] : url.searchParams.get('source_branch');
      const open = pullRequests.filter((p) => p.provider === provider && p.repo === repo && p.open && p.head === head);
      return send(
        res,
        200,
        open.map((p) =>
          provider === 'github' ? { number: p.number, html_url: webUrl(p) } : { iid: p.number, web_url: webUrl(p) },
        ),
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('FakeHosting is not listening on TCP');
  const base = `http://127.0.0.1:${address.port}`;

  /** The latest pull request from `head`: where reviewers comment. */
  function pullRequestOf(head: string): FakePullRequest {
    const pr = pullRequests.findLast((p) => p.head === head);
    if (pr === undefined) throw new Error(`FakeHosting has no pull request from ${head}`);
    return pr;
  }

  return {
    /** Pass as `createTestApp({ hosting })`; a self-hosted GitLab binding uses `gitlabUrl` as its base URL. */
    endpoints: { githubApiUrl: `${base}/github`, gitlabUrl: `${base}/gitlab` } satisfies HostingEndpoints,
    pullRequests,
    failNextPullRequest(status: number, message: string): void {
      failNext = { status, message };
    },
    /** A reviewer's thread on a line of the pull request from `head`. */
    addReviewThread(
      head: string,
      thread: { path: string; line: number; resolved?: boolean; messages: FakeMessageInput[] },
    ): void {
      pullRequestOf(head).threads.push({
        ...thread,
        resolved: thread.resolved ?? false,
        messages: thread.messages.map(message),
      });
    },
    /** A comment in the conversation of the pull request from `head`. */
    addComment(head: string, comment: FakeMessageInput): void {
      pullRequestOf(head).comments.push(message(comment));
    },
    /** The pull request from `head` is merged or closed on the platform. */
    closePullRequest(head: string): void {
      pullRequestOf(head).open = false;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
export type FakeHosting = Awaited<ReturnType<typeof createFakeHosting>>;
