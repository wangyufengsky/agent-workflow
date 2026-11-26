import { randomUUID } from 'node:crypto';
import { BuiltinRoleKey, EMPTY_SECTION, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  ACTIVE_ATTEMPT_STATUSES,
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  DESIGN_IMPACT_PROMPT_MAX_BYTES,
  type DiffFile,
  type DiffSide,
  ErrorCode,
  type GitFindingStatus,
  type GitReviewDTO,
  GitReviewTarget,
  type GitReviewTargetInput,
  type ProjectDTO,
  ServerEventType,
  SessionAgent,
  type SubmitFindingsInput,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { createDesignsRepo, createReviewKnowledgeReader } from '../designs/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { buildGitComparison, mergeGitComparison, renderGitComparison } from './git-reviews.comparison.ts';
import {
  readReviewEvidence,
  recordWorktreeFiles,
  validateComparisonPaths,
  validateReviewImpacts,
  worktreeChanged,
} from './git-reviews.evidence.ts';
import { exportGitReviewReport } from './git-reviews.exporter.ts';
import { renderDesignImpact, screenDesignImpact } from './git-reviews.impact.ts';
import { createGitReviewsRepo, type Review } from './git-reviews.repo.ts';
import { readCommands, resolveTarget, validateFindings } from './git-reviews.target.ts';

export type GitReviewsServiceDeps = {
  db: Db;
  designs: Pick<ReturnType<typeof createDesignsRepo>, 'findDesign'>;
  readKnowledge: ReturnType<typeof createReviewKnowledgeReader>;
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

/** What the reviewer is told it looks at (27 §4.3). */
const SCOPE: Record<GitReviewTarget, (label: string) => string> = {
  [GitReviewTarget.Worktree]: (label) => `The uncommitted changes in the main worktree (branch ${label}).`,
  [GitReviewTarget.Commit]: (label) => `Commit ${label}.`,
  [GitReviewTarget.Branch]: (label) => `Branch ${label}, from where it left the project's default branch.`,
  [GitReviewTarget.Range]: (label) => `The changes ${label}.`,
  [GitReviewTarget.Compare]: (label) =>
    `Compare the two frozen endpoints ${label} directly. Trace business changes against both versions.`,
};

const fileLine = (f: DiffFile) =>
  `- ${f.oldPath ? `\`${f.oldPath}\` → ` : ''}\`${f.path}\` (${f.status}${f.additions === null ? ', binary' : `, +${f.additions} −${f.deletions ?? 0}`})`;

/** AI reviews in the Git workbench (27 §4, D109): read-only attempts that report structured findings. */
export function createGitReviewsService(deps: GitReviewsServiceDeps) {
  const { unit, clock, attempts, projects, roles, settings, prompts } = deps;
  const repo = createGitReviewsRepo(deps.db);

  function mustFind(id: string): Review {
    const review = repo.find(id);
    if (review === undefined) throw new AppError(ErrorCode.GitReviewNotFound, `No review ${id}`, { id });
    return review;
  }

  function patterns(designId: string | null) {
    return designId === null ? [] : (deps.designs.findDesign(designId)?.excludePatterns ?? []);
  }

  function evidencePatterns(review: Review) {
    const current = patterns(review.designId);
    const fromId = review.comparison?.fromDesignId;
    return { old: fromId && fromId !== review.designId ? patterns(fromId) : current, new: current };
  }

  function toDto(review: Review): GitReviewDTO {
    const attempt = attempts.get(review.attemptId);
    return {
      id: review.id,
      attemptId: review.attemptId,
      projectId: review.projectId,
      target: review.target,
      label: review.label,
      from: review.fromSha,
      to: review.toSha,
      parent: review.parent,
      focus: review.focus,
      files: review.files.map(({ worktreeHash: _hash, designUncovered: _uncovered, ...file }) => file),
      uncoveredPaths: [...new Set(review.files.flatMap((file) => file.designUncovered ?? []))],
      designId: review.designId,
      designMatch: review.designMatch,
      designSnapshotSha: review.designSnapshotSha,
      impactTruncated: review.impactTruncated,
      impacts: review.impacts,
      regressionChecks: review.regressionChecks,
      comparison: review.comparison,
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

  const isRunning = (review: Review) => ACTIVE_ATTEMPT_STATUSES.includes(attempts.get(review.attemptId).status);

  /**
   * Projects whose review is being started: between the check and the review's row, resolving the diff awaits git,
   * and a second request in that window would start a second (billable) session.
   */
  const starting = new Set<string>();

  function assertIdle(projectId: string): void {
    if (starting.has(projectId)) {
      throw new AppError(ErrorCode.GitReviewRunning, 'A review of this project is being started', { projectId });
    }
    const running = repo.list(projectId).find(isRunning);
    if (running !== undefined) {
      throw new AppError(ErrorCode.GitReviewRunning, 'A review of this project is still running', {
        reviewId: running.id,
      });
    }
  }

  /** Resolves the diff, starts the review's attempt and records the review; the caller awaits the start. */
  async function begin(project: ProjectDTO, input: GitReviewTargetInput, focus: string | undefined) {
    const target = await resolveTarget(project.repoPath, project.defaultBranch, input);
    if (target.files.length === 0 && target.target !== GitReviewTarget.Compare) {
      throw new AppError(ErrorCode.ValidationFailed, 'There are no changes to review', {
        issues: [{ path: ['target'], message: 'no changes' }],
      });
    }
    const selection = await deps.readKnowledge(project.id, target.to, project.repoPath);
    const comparison =
      target.target === GitReviewTarget.Compare
        ? buildGitComparison(
            await deps.readKnowledge(project.id, target.from, project.repoPath),
            selection,
            target.files,
          )
        : undefined;
    const screened = screenDesignImpact(selection, target.files);
    const alignment = comparison ? `${renderGitComparison(comparison, DESIGN_IMPACT_PROMPT_MAX_BYTES / 2)}\n\n` : '';
    const { context, truncated } = renderDesignImpact(
      screened,
      DESIGN_IMPACT_PROMPT_MAX_BYTES - Buffer.byteLength(alignment),
    );
    const snapshotId = selection.knowledge?.designId ?? null;
    const files =
      target.to === null
        ? await recordWorktreeFiles(project.repoPath, target.files, patterns(snapshotId))
        : target.files;
    // 工作区取证期间用户可能删除设计，报告仍保留本次实际使用的匹配度和提交。
    const designId = snapshotId !== null && deps.designs.findDesign(snapshotId) ? snapshotId : null;
    const reviewer = roles.getByKey(BuiltinRoleKey.Reviewer);
    const attemptId = randomUUID();
    const started = attempts.start({
      id: attemptId,
      kind: AttemptKind.GitReview,
      agent: SessionAgent.CodeReviewer,
      projectId: project.id,
      taskId: null,
      nodeId: null,
      roleId: reviewer.id,
      directory: project.repoPath,
      title: `${SESSION_TITLE_PREFIX} · ${project.name} · ${target.label}`,
      model: reviewer.model ?? settings.get('ai.defaultModel'),
      prompt: renderTemplate(prompts[PromptName.StartGitReview], {
        projectName: project.name,
        designImpact: alignment + context,
        scope: SCOPE[target.target](target.label),
        readCommands: readCommands(target),
        files: target.files.map(fileLine).join('\n'),
        focus: focus ?? EMPTY_SECTION,
      }),
    });
    const review = {
      id: randomUUID(),
      projectId: project.id,
      target: target.target,
      label: target.label,
      fromSha: target.from,
      parent: target.parent,
      toSha: target.to,
      focus: focus ?? null,
      attemptId,
      files: files.map((file) => {
        const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
        const uncovered = paths.filter((path) => screened.uncoveredPathSet.has(path));
        return uncovered.length ? { ...file, designUncovered: uncovered } : file;
      }),
      designId,
      designSnapshotSha: selection.knowledge?.sourceSnapshot.commitSha ?? null,
      designMatch: selection.match,
      impactTruncated: truncated,
      comparison,
      createdAt: clock.now(),
    };
    unit.transact(() => {
      repo.insert(review);
      publish(review);
    });
    return { review, started };
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
    async detail(id: string): Promise<GitReviewDTO> {
      const review = mustFind(id);
      const dto = toDto(review);
      if (review.toSha === null && dto.status === AttemptStatus.Succeeded) {
        const { repoPath } = projects.getRecord(review.projectId);
        dto.worktreeChanged = await worktreeChanged(repoPath, review, patterns(review.designId));
      }
      return dto;
    },
    list: (projectId: string, toSha?: string): GitReviewDTO[] => {
      projects.getRecord(projectId);
      return repo.list(projectId, toSha).map(toDto);
    },

    /** Starts a review of a diff; one review per project at a time, not counted in the scheduler (27 §4.3). */
    async start(projectId: string, input: GitReviewTargetInput, focus: string | undefined): Promise<GitReviewDTO> {
      const project = projects.getRecord(projectId);
      attempts.requireReady();
      assertIdle(projectId);
      starting.add(projectId);
      try {
        const { review, started } = await begin(project, input, focus);
        await started;
        return toDto(mustFind(review.id));
      } finally {
        starting.delete(projectId);
      }
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
      const exclusions = evidencePatterns(review);
      await validateReviewImpacts(repoPath, review, input, exclusions);
      const comparison = mergeGitComparison(review.comparison, input.comparison, input.summary);
      if (input.comparison && review.toSha !== null) {
        await validateComparisonPaths(
          repoPath,
          review.fromSha,
          review.toSha,
          review.files,
          input.comparison,
          exclusions,
        );
      }
      unit.transact(() => {
        repo.setResult(review.id, input.summary, input.findings, input.impacts, input.regression_checks, comparison);
        attempts.markSubmitted(attempt.id);
        publish(review);
      });
    },

    updateFindingStatus(id: string, findingId: string, status: GitFindingStatus) {
      return unit.transact(() => {
        mustFind(id);
        const updated = repo.updateFindingStatus(id, findingId, status);
        if (!updated) throw new AppError(ErrorCode.NotFound, 'No such finding in this review', { findingId });
        publish(updated);
        return toDto(updated);
      });
    },

    evidence(id: string, path: string, side: DiffSide) {
      const review = mustFind(id);
      return readReviewEvidence(
        projects.getRecord(review.projectId).repoPath,
        review,
        path,
        side,
        evidencePatterns(review),
      );
    },

    export(id: string, targetDir: string, overwrite?: boolean) {
      const review = toDto(mustFind(id));
      if (review.status !== AttemptStatus.Succeeded)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'Only a completed review can be exported');
      return exportGitReviewReport(review, projects.getRecord(review.projectId), targetDir, overwrite);
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
