import { randomUUID } from 'node:crypto';
import { BuiltinRoleKey, EMPTY_SECTION, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  type DiffFile,
  ErrorCode,
  type GitReviewDTO,
  GitReviewTarget,
  type GitReviewTargetInput,
  ServerEventType,
  SessionAgent,
  type SubmitFindingsInput,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createGitReviewsRepo, type Review } from './git-reviews.repo.ts';
import { readCommands, resolveTarget, validateFindings } from './git-reviews.target.ts';

export type GitReviewsServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  attempts: AttemptsService;
  projects: ProjectsService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
};

/** Prefix of the opencode session titles of reviews (the titles show only in opencode). */
const SESSION_TITLE_PREFIX = 'Review';

const ACTIVE: readonly AttemptStatus[] = [AttemptStatus.Starting, AttemptStatus.Running];

/** What the reviewer is told it looks at (27 §4.3). */
const SCOPE: Record<GitReviewTarget, (label: string) => string> = {
  [GitReviewTarget.Worktree]: (label) => `The uncommitted changes in the main worktree (branch ${label}).`,
  [GitReviewTarget.Commit]: (label) => `Commit ${label}.`,
  [GitReviewTarget.Branch]: (label) => `Branch ${label}, from where it left the project's default branch.`,
  [GitReviewTarget.Range]: (label) => `The changes ${label}.`,
};

const fileLine = (f: DiffFile) =>
  `- \`${f.path}\` (${f.status}${f.additions === null ? ', binary' : `, +${f.additions} −${f.deletions ?? 0}`})`;

/** AI reviews in the Git workbench (27 §4, D109): read-only attempts that report structured findings. */
export function createGitReviewsService(deps: GitReviewsServiceDeps) {
  const { unit, clock, attempts, projects, roles, settings, prompts } = deps;
  const repo = createGitReviewsRepo(deps.db);

  function mustFind(id: string): Review {
    const review = repo.find(id);
    if (review === undefined) throw new AppError(ErrorCode.GitReviewNotFound, `No review ${id}`, { id });
    return review;
  }

  function toDto(review: Review): GitReviewDTO {
    const attempt = attempts.get(review.attemptId);
    return {
      id: review.id,
      projectId: review.projectId,
      target: review.target,
      label: review.label,
      from: review.fromSha,
      to: review.toSha,
      focus: review.focus,
      files: review.files,
      status: attempt.status,
      model: attempt.model,
      error: attempt.error,
      summary: review.summary,
      findings: review.findings,
      createdAt: review.createdAt,
      finishedAt: review.finishedAt,
    };
  }

  const publish = (review: Pick<Review, 'id' | 'projectId'>) =>
    unit.publish({
      type: ServerEventType.GitReviewUpdated,
      data: { reviewId: review.id, projectId: review.projectId },
    });

  const isRunning = (review: Review) => ACTIVE.includes(attempts.get(review.attemptId).status);

  function assertIdle(projectId: string): void {
    const running = repo.list(projectId).find(isRunning);
    if (running !== undefined) {
      throw new AppError(ErrorCode.GitReviewRunning, 'A review of this project is still running', {
        reviewId: running.id,
      });
    }
  }

  attempts.onSignal(({ type, attempt }) => {
    if (attempt.kind !== AttemptKind.GitReview) return;
    const review = repo.findByAttempt(attempt.id);
    // Every review attempt is recorded with its review in the call that starts it.
    if (review === undefined) throw new Error(`Review attempt ${attempt.id} has no review`);
    unit.transact(() => {
      if (type === 'ended') repo.finish(review.id, clock.now());
      publish(review);
    });
  });

  return {
    get: (id: string): GitReviewDTO => toDto(mustFind(id)),
    list: (projectId: string, toSha?: string): GitReviewDTO[] => {
      projects.getRecord(projectId);
      return repo.list(projectId, toSha).map(toDto);
    },

    /** Starts a review of a diff; one review per project at a time, not counted in the scheduler (27 §4.3). */
    async start(projectId: string, input: GitReviewTargetInput, focus: string | undefined): Promise<GitReviewDTO> {
      const project = projects.getRecord(projectId);
      attempts.requireReady();
      assertIdle(projectId);
      const target = await resolveTarget(project.repoPath, project.defaultBranch, input);
      if (target.files.length === 0) {
        throw new AppError(ErrorCode.ValidationFailed, 'There are no changes to review', {
          issues: [{ path: ['target'], message: 'no changes' }],
        });
      }
      const reviewer = roles.getByKey(BuiltinRoleKey.Reviewer);
      const attemptId = randomUUID();
      const started = attempts.start({
        id: attemptId,
        kind: AttemptKind.GitReview,
        agent: SessionAgent.CodeReviewer,
        taskId: null,
        nodeId: null,
        roleId: reviewer.id,
        directory: project.repoPath,
        title: `${SESSION_TITLE_PREFIX} · ${project.name} · ${target.label}`,
        model: reviewer.model ?? settings.get('ai.defaultModel'),
        prompt: renderTemplate(prompts[PromptName.StartGitReview], {
          projectName: project.name,
          scope: SCOPE[target.target](target.label),
          readCommands: readCommands(target),
          files: target.files.map(fileLine).join('\n'),
          focus: focus ?? EMPTY_SECTION,
        }),
      });
      const review = {
        id: randomUUID(),
        projectId,
        target: target.target,
        label: target.label,
        fromSha: target.from,
        toSha: target.to,
        focus: focus ?? null,
        attemptId,
        files: target.files,
        createdAt: clock.now(),
      };
      unit.transact(() => {
        repo.insert(review);
        publish(review);
      });
      await started;
      return toDto(mustFind(review.id));
    },

    async stop(id: string): Promise<GitReviewDTO> {
      const review = mustFind(id);
      await attempts.abort(review.attemptId);
      return toDto(mustFind(id));
    },

    /** `submit_findings` (27 §4.4): checked against the reviewed diff, then stored and the attempt finishes. */
    async submitFindings(attempt: AttemptDTO, input: SubmitFindingsInput): Promise<void> {
      const review = repo.findByAttempt(attempt.id);
      if (review === undefined) throw new Error(`Review attempt ${attempt.id} has no review`);
      const { repoPath } = projects.getRecord(review.projectId);
      await validateFindings(repoPath, { from: review.fromSha, to: review.toSha, files: review.files }, input.findings);
      unit.transact(() => {
        repo.setResult(review.id, input.summary, input.findings);
        attempts.markSubmitted(attempt.id);
        publish(review);
      });
    },

    /** Deleting a project (by the tasks module): no review may be running. */
    assertProjectIdle: assertIdle,

    /** Within the project deletion's transaction: the reviews go with the project, their attempts here. */
    deleteByProject(projectId: string): void {
      const attemptIds = repo.attemptIdsOf(projectId);
      repo.deleteByProject(projectId);
      attempts.delete(attemptIds);
    },
  };
}
export type GitReviewsService = ReturnType<typeof createGitReviewsService>;
