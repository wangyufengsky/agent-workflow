import { AppError, ErrorCode, ReviewCommentKind } from '@aw/shared';
import { GitbeakerRequestError, Gitlab } from '@gitbeaker/rest';
import { z } from 'zod';
import {
  basicAuthorization,
  type GitHostingProvider,
  hostingError,
  type PlatformReviewComment,
  REVIEW_COMMENTS_MAX,
  unreachableError,
} from './hosting.types.ts';

async function translate(err: unknown): Promise<never> {
  if (err instanceof TypeError && err.cause !== undefined) throw unreachableError(err.cause);
  if (err instanceof GitbeakerRequestError && err.cause !== undefined) {
    throw hostingError(err.cause.response.status, err.cause.description);
  }
  throw err;
}

/** The fields of a merge request discussion the review comments need (21 §2.2). */
const discussionsSchema = z.array(
  z.object({
    id: z.string(),
    notes: z.array(
      z.object({
        id: z.number(),
        body: z.string(),
        author: z.object({ username: z.string() }),
        created_at: z.string(),
        system: z.boolean(),
        resolvable: z.boolean(),
        resolved: z.boolean().optional(),
        position: z.object({ new_path: z.string(), new_line: z.number().nullable() }).nullish(),
      }),
    ),
  }),
);

const statusSchema = z.object({
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  sha: z.string(),
  target_branch: z.string(),
  merge_commit_sha: z.string().nullable(),
  squash_commit_sha: z.string().nullable(),
  head_pipeline: z.object({ sha: z.string(), status: z.string() }).nullable().optional(),
});
const approvalSchema = z.object({ approved: z.boolean(), approvals_left: z.number().optional() });

/** The user name a token signs in as; HOSTING_AUTH_FAILED when GitLab rejects it (D155). */
export async function gitlabAccount(token: string, host: string): Promise<string> {
  const user = await new Gitlab({ host, token }).Users.showCurrentUser().catch(translate);
  return user.username;
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
    async findOpenPullRequest(branch) {
      const requests = await api.MergeRequests.all({ projectId: repo, sourceBranch: branch, state: 'opened' }).catch(
        translate,
      );
      const [request] = requests;
      return request === undefined ? undefined : { number: request.iid, url: request.web_url };
    },
    async getPullRequestStatus(number) {
      const raw = await api.MergeRequests.show(repo, number).catch(translate);
      const pr = statusSchema.parse(raw);
      const approvals = approvalSchema.parse(
        await api.MergeRequestApprovals.showConfiguration(repo, {
          mergerequestIId: number,
        }).catch(translate),
      );
      const after = statusSchema.parse(await api.MergeRequests.show(repo, number).catch(translate));
      if (after.sha !== pr.sha || after.state !== pr.state) {
        throw new AppError(ErrorCode.HostingApiError, 'The merge request changed while its status was read');
      }
      return {
        state: pr.state === 'opened' ? 'open' : pr.state,
        head: pr.sha,
        targetBranch: pr.target_branch,
        mergeCommit: pr.state === 'merged' ? (pr.merge_commit_sha ?? pr.squash_commit_sha) : null,
        ci: pr.head_pipeline?.sha === pr.sha ? pr.head_pipeline.status : null,
        review: approvals.approved ? 'approved' : 'awaiting',
      };
    },
    async listReviewComments({ number, url }) {
      const raw = await api.MergeRequestDiscussions.all(repo, number, {
        perPage: REVIEW_COMMENTS_MAX,
        maxPages: 1,
      }).catch(translate);
      return discussionsSchema.parse(raw).flatMap((d): PlatformReviewComment[] => {
        const notes = d.notes.filter((n) => !n.system && n.body.trim() !== '');
        const [first] = notes;
        if (first === undefined) return [];
        // Threads (diff notes and started discussions) can be resolved; a plain comment cannot.
        const thread = notes.some((n) => n.resolvable);
        if (thread && notes.every((n) => !n.resolvable || n.resolved === true)) return [];
        return [
          {
            id: d.id,
            kind: thread ? ReviewCommentKind.Thread : ReviewCommentKind.General,
            path: thread ? (first.position?.new_path ?? null) : null,
            line: thread ? (first.position?.new_line ?? null) : null,
            url: `${url}#note_${first.id}`,
            messages: notes.map((n) => ({
              author: n.author.username,
              body: n.body,
              createdAt: Date.parse(n.created_at),
            })),
          },
        ];
      });
    },
    gitAuthorization: () => basicAuthorization('oauth2', token),
  };
}
