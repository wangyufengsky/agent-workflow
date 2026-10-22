import { BuiltinRoleKey, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  ACCEPTANCE_COMMAND_TIMEOUT_MS,
  ACCEPTANCE_OUTPUT_MAX_CHARS,
  AcceptanceCheckKind,
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  type CheckResult,
  ErrorCode,
  IssueSeverity,
  ReviewVerdict,
  type SubmitReviewInput,
} from '@aw/shared';
import { execa } from 'execa';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import { locateShell } from '../git/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { unrunnableOf } from './acceptance.rules.ts';

export type AcceptanceServiceDeps = {
  attempts: AttemptsService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
  log: Logger;
  clock: Clock;
  /** Environment of check commands (PATH to the project's tools). */
  env: NodeJS.ProcessEnv;
};

export type CommandCheckResult = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.Command }>;
export type ReviewCheckResult = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.AiReview }>;

/** What a review needs to know about the step under review and its task. */
export type ReviewRequest = {
  nodeId: string;
  taskId: string;
  projectId: string;
  taskKey: string;
  taskTitle: string;
  requirement: string;
  nodeTitle: string;
  instructions: string;
  resultSummary: string;
  focus: string | undefined;
  directory: string;
  /** The project check and the node's command checks, which the reviewer may run without asking. */
  checkCommands: readonly string[];
};

/** A review either completes with a verdict or is interrupted with the runtime (then the node starts over). */
export type ReviewOutcome = { interrupted: false; result: ReviewCheckResult } | { interrupted: true };

const FOCUS_DEFAULT = 'Whether the step does what its instructions and the requirement ask.';

/** Keeps the end of long output, where test runners report failures. */
export function tailOf(output: string): string {
  return output.length <= ACCEPTANCE_OUTPUT_MAX_CHARS ? output : output.slice(-ACCEPTANCE_OUTPUT_MAX_CHARS);
}

/**
 * Acceptance checks of a node (03 §4.2 `AcceptanceCheck`): `command` runs in the worktree, `ai_review` is a review
 * attempt that ends with `submit_review`. A pending review is kept in memory: after a restart its node starts over.
 */
export function createAcceptanceService({
  attempts,
  roles,
  settings,
  prompts,
  log,
  clock,
  env,
}: AcceptanceServiceDeps) {
  /** Open reviews by the node under review (a node runs at most one review at a time). */
  const pending = new Map<string, { focus: string | null; settle: (outcome: ReviewOutcome) => void }>();

  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.kind !== AttemptKind.Review || attempt.nodeId === null) return;
    if (attempt.status === AttemptStatus.Succeeded) return;
    const review = pending.get(attempt.nodeId);
    if (review === undefined) return;
    pending.delete(attempt.nodeId);
    review.settle(
      attempt.status === AttemptStatus.Interrupted
        ? { interrupted: true }
        : {
            interrupted: false,
            result: {
              kind: AcceptanceCheckKind.AiReview,
              focus: review.focus,
              passed: false,
              output: `The review did not complete (${attempt.error?.code ?? attempt.status}).`,
              attemptId: attempt.id,
              issues: [],
            },
          },
    );
  });

  return {
    /**
     * Runs the command in the worktree; exit code 0 within ACCEPTANCE_COMMAND_TIMEOUT_MS passes. A timeout or the
     * signal ends the command with everything it started (D73). A command the environment cannot run is told apart
     * (`unrunnable`, D116).
     */
    async runCommand(directory: string, command: string, signal: AbortSignal): Promise<CommandCheckResult> {
      const child = execa(command, {
        cwd: directory,
        // A check command is a POSIX shell command line on every platform (`pnpm test`, `mvn -q test && …`, D73).
        shell: await locateShell(env),
        env,
        extendEnv: false,
        all: true,
        reject: false,
        stdin: 'ignore',
        // A shell ended alone leaves its commands running, holding the output and worktree files (D73).
        killDescendants: true,
      });
      let timedOut = false;
      const stop = () => child.kill();
      const cancelTimeout = clock.schedule(ACCEPTANCE_COMMAND_TIMEOUT_MS, () => {
        timedOut = true;
        stop();
      });
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
      const result = await child;
      cancelTimeout();
      signal.removeEventListener('abort', stop);
      const exitCode = timedOut ? null : (result.exitCode ?? null);
      const output = result.all ?? '';
      const unrunnable = unrunnableOf(command, exitCode, output);
      log.info({ directory, command, exitCode, timedOut, unrunnable }, 'acceptance command finished');
      return {
        kind: AcceptanceCheckKind.Command,
        command,
        passed: exitCode === 0,
        output: tailOf(output),
        exitCode,
        timedOut,
        unrunnable,
        skipped: false,
      };
    },

    /** Starts a review attempt as the reviewer role and resolves with its verdict. */
    async review(request: ReviewRequest, signal: AbortSignal): Promise<ReviewOutcome> {
      const reviewer = roles.getByKey(BuiltinRoleKey.Reviewer);
      const focus = request.focus ?? null;
      const outcome = new Promise<ReviewOutcome>((resolve) => {
        pending.set(request.nodeId, { focus, settle: resolve });
      });
      let attemptId: string | undefined;
      // Cancelling the task stops the review session; its end settles the outcome.
      const stop = () => {
        if (attemptId === undefined || attempts.get(attemptId).status !== AttemptStatus.Running) return;
        attempts.abort(attemptId).catch((err: unknown) => log.error({ err, attemptId }, 'review abort failed'));
      };
      signal.addEventListener('abort', stop);
      try {
        const attempt = await attempts.start({
          kind: AttemptKind.Review,
          taskId: request.taskId,
          projectId: request.projectId,
          nodeId: request.nodeId,
          roleId: reviewer.id,
          agent: reviewer.baseAgent,
          directory: request.directory,
          title: `${request.taskKey} · ${request.nodeTitle} · review`,
          model: reviewer.model ?? settings.get('ai.defaultModel'),
          system: reviewer.prompt,
          checkCommands: request.checkCommands,
          prompt: renderTemplate(prompts[PromptName.StartReview], {
            taskKey: request.taskKey,
            taskTitle: request.taskTitle,
            requirement: request.requirement,
            nodeTitle: request.nodeTitle,
            instructions: request.instructions,
            resultSummary: request.resultSummary,
            focus: request.focus ?? FOCUS_DEFAULT,
          }),
        });
        attemptId = attempt.id;
      } catch (err) {
        pending.delete(request.nodeId);
        // The runtime went away before the review could start: the node starts over, as after a restart.
        if (err instanceof AppError && err.code === ErrorCode.OpencodeNotReady) return { interrupted: true };
        throw err;
      }
      if (signal.aborted) stop();
      return outcome;
    },

    /** `submit_review` (12 §6.6): a failing verdict must name at least one blocker or major issue. */
    submitReview(attempt: AttemptDTO, input: SubmitReviewInput): { accepted: true } {
      const issues = input.issues ?? [];
      if (
        input.verdict === ReviewVerdict.Fail &&
        !issues.some((i) => i.severity === IssueSeverity.Blocker || i.severity === IssueSeverity.Major)
      ) {
        throw new AppError(ErrorCode.ValidationFailed, 'A failing review needs a blocker or major issue', {
          issues: [{ path: ['issues'], message: 'fail requires at least one blocker or major issue' }],
        });
      }
      const nodeId = attempt.nodeId;
      const review = nodeId === null ? undefined : pending.get(nodeId);
      if (nodeId === null || review === undefined) {
        throw new AppError(ErrorCode.McpAttemptUnresolved, 'No review is waiting for this attempt', {
          attemptId: attempt.id,
        });
      }
      pending.delete(nodeId);
      attempts.markSubmitted(attempt.id);
      review.settle({
        interrupted: false,
        result: {
          kind: AcceptanceCheckKind.AiReview,
          focus: review.focus,
          passed: input.verdict === ReviewVerdict.Pass,
          output: input.summary,
          attemptId: attempt.id,
          issues,
        },
      });
      return { accepted: true };
    },
  };
}
export type AcceptanceService = ReturnType<typeof createAcceptanceService>;
