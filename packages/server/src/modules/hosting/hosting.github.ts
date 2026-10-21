import { ReviewCommentKind } from '@aw/shared';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';
import {
  basicAuthorization,
  type GitHostingProvider,
  hostingError,
  type PlatformReviewComment,
  REVIEW_COMMENTS_MAX,
} from './hosting.types.ts';

/**
 * `status` and `response.data` of an Octokit RequestError; a GraphQL answer with `errors` (HTTP 200) is a platform
 * error without a status. Anything else is not a platform answer.
 */
function translate(err: unknown): never {
  if (err instanceof Error && 'status' in err && typeof err.status === 'number') {
    const response = 'response' in err ? err.response : undefined;
    const body = typeof response === 'object' && response !== null && 'data' in response ? response.data : undefined;
    throw hostingError(err.status, body);
  }
  if (err instanceof Error && 'errors' in err) throw hostingError(undefined, err.errors);
  throw err;
}

/** Replies read per review thread. */
const THREAD_REPLIES_MAX = 50;

/**
 * Review threads with their resolution exist only in GraphQL; REST review comments do not say whether their thread
 * is resolved (21 §2.2).
 */
const REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${REVIEW_COMMENTS_MAX}) {
        nodes { id isResolved path line originalLine
          comments(first: ${THREAD_REPLIES_MAX}) { nodes { author { login } body createdAt url } } }
      }
      comments(first: ${REVIEW_COMMENTS_MAX}) { nodes { id author { login } body createdAt url } }
      reviews(first: ${REVIEW_COMMENTS_MAX}) { nodes { id author { login } body submittedAt url } }
    }
  }
}`;

// A deleted account answers `author: null`; GitHub shows it as「ghost」.
const authorSchema = z
  .object({ login: z.string() })
  .nullable()
  .transform((a) => a?.login ?? 'ghost');
const messageSchema = z.object({ author: authorSchema, body: z.string(), createdAt: z.string(), url: z.string() });
const reviewDataSchema = z.object({
  repository: z.object({
    pullRequest: z.object({
      reviewThreads: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            isResolved: z.boolean(),
            path: z.string(),
            line: z.number().nullable(),
            originalLine: z.number().nullable(),
            comments: z.object({ nodes: z.array(messageSchema) }),
          }),
        ),
      }),
      comments: z.object({ nodes: z.array(messageSchema.extend({ id: z.string() })) }),
      reviews: z.object({
        nodes: z.array(
          // A pending review (the token owner's own draft) has not been submitted.
          z.object({
            id: z.string(),
            author: authorSchema,
            body: z.string(),
            submittedAt: z.string().nullable(),
            url: z.string(),
          }),
        ),
      }),
    }),
  }),
});

const toMessage = (m: { author: string; body: string; createdAt: string }) => ({
  author: m.author,
  body: m.body,
  createdAt: Date.parse(m.createdAt),
});

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
    async findOpenPullRequest(branch) {
      const { data } = await octokit.rest.pulls
        .list({ owner, repo: name, head: `${owner}:${branch}`, state: 'open' })
        .catch(translate);
      const [pull] = data;
      return pull === undefined ? undefined : { number: pull.number, url: pull.html_url };
    },
    async listReviewComments({ number }) {
      const data = await octokit.graphql(REVIEW_QUERY, { owner, name, number }).catch(translate);
      const { reviewThreads, comments, reviews } = reviewDataSchema.parse(data).repository.pullRequest;
      const threads = reviewThreads.nodes.flatMap((t): PlatformReviewComment[] => {
        const [first] = t.comments.nodes;
        if (t.isResolved || first === undefined) return [];
        return [
          {
            id: t.id,
            kind: ReviewCommentKind.Thread,
            path: t.path,
            line: t.line ?? t.originalLine,
            url: first.url,
            messages: t.comments.nodes.map(toMessage),
          },
        ];
      });
      const general = [
        ...comments.nodes.map((c) => ({ id: c.id, url: c.url, message: toMessage(c) })),
        ...reviews.nodes.flatMap(({ submittedAt, ...r }) =>
          submittedAt === null ? [] : [{ id: r.id, url: r.url, message: toMessage({ ...r, createdAt: submittedAt }) }],
        ),
      ]
        .filter((c) => c.message.body.trim() !== '')
        .sort((a, b) => a.message.createdAt - b.message.createdAt)
        .map(
          (c): PlatformReviewComment => ({
            id: c.id,
            kind: ReviewCommentKind.General,
            path: null,
            line: null,
            url: c.url,
            messages: [c.message],
          }),
        );
      return [...threads, ...general];
    },
    gitAuthorization: () => basicAuthorization('x-access-token', token),
  };
}
