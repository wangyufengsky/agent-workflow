import { stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { EMPTY_SECTION, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  ErrorCode,
  ResultNext,
  RoleBaseAgent,
  type SubmitResultInput,
  type TaskContext,
  WorkflowDeliverable,
} from '@aw/shared';
import type { AttemptsService } from '../attempts/index.ts';
import { readHead, readRepoRoot } from '../git/index.ts';
import type { SettingsService } from '../settings/index.ts';

export type DebugServiceDeps = { attempts: AttemptsService; settings: SettingsService; prompts: Prompts };

/** Stands in for the task, plan and node a real attempt belongs to. */
type DebugRun = { requirement: string; title: string; directory: string; branch: string; baseCommit: string };

const DEBUG_TASK_KEY = 'DEBUG';
const DEBUG_NODE_KEY = 'debug';

const firstLine = (text: string) => text.trim().split('\n')[0] ?? '';

async function requireGitDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory))
    throw new AppError(ErrorCode.ValidationFailed, 'directory must be absolute', { directory });
  const isDirectory = await stat(directory).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDirectory || (await readRepoRoot(directory)) === undefined) {
    throw new AppError(ErrorCode.ProjectPathNotGitRepo, 'Not inside a Git repository', { directory });
  }
}

/**
 * Development-build debug attempts (M2-09): one execute attempt on a directory with no task around it. It owns the
 * attempt the way nodes will (M3): it provides the task context and receives the result. Runs live in memory only.
 */
export function createDebugService({ attempts, settings, prompts }: DebugServiceDeps) {
  const runs = new Map<string, DebugRun>();

  function runOf(attempt: AttemptDTO): DebugRun {
    const run = runs.get(attempt.id);
    if (run === undefined) {
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'Attempt belongs to no task or debug run', {
        attemptId: attempt.id,
      });
    }
    return run;
  }

  return {
    async start(input: { directory: string; requirement: string; model?: string | undefined }): Promise<AttemptDTO> {
      await requireGitDirectory(input.directory);
      const head = await readHead(input.directory);
      const run: DebugRun = {
        requirement: input.requirement,
        title: firstLine(input.requirement),
        directory: input.directory,
        branch: head.branch ?? 'HEAD',
        baseCommit: head.commit,
      };
      const prompt = renderTemplate(prompts[PromptName.StartExecute], {
        taskKey: DEBUG_TASK_KEY,
        taskTitle: run.title,
        requirement: run.requirement,
        nodeTitle: run.title,
        instructions: run.requirement,
        retryFeedback: EMPTY_SECTION,
        uncertaintyRule: prompts[settings.get('ai.askOnUncertainty') ? PromptName.RuleAsk : PromptName.RuleAssume],
      });
      const attempt = await attempts.start({
        kind: AttemptKind.Execute,
        agent: RoleBaseAgent.Executor,
        taskId: null,
        projectId: null,
        nodeId: null,
        roleId: null,
        directory: input.directory,
        title: `${DEBUG_TASK_KEY} · ${run.title}`,
        model: input.model ?? settings.get('ai.defaultModel'),
        prompt,
      });
      runs.set(attempt.id, run);
      return attempt;
    },

    taskContext(attempt: AttemptDTO): TaskContext {
      const run = runOf(attempt);
      return {
        task: {
          key: DEBUG_TASK_KEY,
          title: run.title,
          requirement: run.requirement,
          workflow: 'debug',
          deliverable: WorkflowDeliverable.CodeChanges,
        },
        project: { name: basename(run.directory), defaultBranch: run.branch },
        workspace: { path: run.directory, branch: run.branch, baseCommit: run.baseCommit },
        attempt: { kind: attempt.kind, seq: attempt.seq },
        askOnUncertainty: settings.get('ai.askOnUncertainty'),
        node: {
          key: DEBUG_NODE_KEY,
          title: run.title,
          role: 'developer',
          instructions: run.requirement,
          acceptance: { checks: [], manual: false },
          dependsOn: [],
        },
        upstream: [],
        answeredQuestions: [],
        userFeedback: [],
        databases: [],
        requirements: [],
      };
    },

    /** A debug run has no acceptance: a submitted result finishes it. */
    submitResult(attempt: AttemptDTO, _result: SubmitResultInput): { accepted: true; next: ResultNext } {
      runOf(attempt);
      attempts.markSubmitted(attempt.id);
      return { accepted: true, next: ResultNext.Done };
    },
  };
}
export type DebugService = ReturnType<typeof createDebugService>;
