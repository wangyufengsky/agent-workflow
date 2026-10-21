import { AppError, ErrorCode, type ReviewCommentDTO } from '@aw/shared';

export type PullRequestInput = { head: string; base: string; title: string; body: string };

/** An open pull (merge) request: its number on the platform (GitLab's `iid`) and web address. */
export type OpenPullRequest = { number: number; url: string };

/** A review comment as the platform has it; whether it is selected by default is the service's call (D87). */
export type PlatformReviewComment = Omit<ReviewCommentDTO, 'selectedByDefault'>;

/** Comments of each kind read from a pull request (21 §2.2); more are not shown. */
export const REVIEW_COMMENTS_MAX = 100;

/** A hosting platform (03 §4.2 extension point) for one repository, authenticated with the project's token. */
export type GitHostingProvider = {
  /** Whether the token can read the repository; HOSTING_AUTH_FAILED otherwise. */
  verify(): Promise<void>;
  /** Opens a pull (merge) request and returns its web address. */
  createPullRequest(input: PullRequestInput): Promise<{ url: string }>;
  /** The open pull request from `branch` of the repository itself, if there is one. */
  findOpenPullRequest(branch: string): Promise<OpenPullRequest | undefined>;
  /** Unresolved review threads and general comments of a pull request (21 §2.2), oldest first. */
  listReviewComments(pullRequest: OpenPullRequest): Promise<PlatformReviewComment[]>;
  /** `Authorization` header value with which git pushes over HTTPS using the token. */
  gitAuthorization(): string;
};

/**
 * A platform's HTTP failure as a domain error (06 §2.1 translation): a rejected token, or a token without access to
 * the repository (which both platforms answer with 404), is HOSTING_AUTH_FAILED; anything else HOSTING_API_ERROR.
 */
export function hostingError(status: number | undefined, body: unknown): AppError {
  if (status === 401 || status === 403 || status === 404) {
    return new AppError(ErrorCode.HostingAuthFailed, 'The token was rejected or cannot access the repository', {
      status,
    });
  }
  return new AppError(ErrorCode.HostingApiError, 'The hosting platform request failed', { status, body });
}

/** HTTP Basic credentials the platforms accept from git with a token as the password. */
export const basicAuthorization = (user: string, token: string) =>
  `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
