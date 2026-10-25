import { randomUUID } from 'node:crypto';
import { BuiltinRoleKey, PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  COMMIT_DRAFT_DIFF_MAX_BYTES,
  ErrorCode,
  SessionAgent,
  type SubmitCommitMessageInput,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import { hasStagedChanges, mergeBase, runGit } from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

export type CommitDraftsDeps = {
  clock: Clock;
  log: Logger;
  attempts: AttemptsService;
  projects: ProjectsService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
};

export type CommitDraft = { subject: string; body: string };

/** Subjects of the repository's recent commits the draft should match. */
const RECENT_SUBJECTS = 10;

/** Cut to `max` bytes at a line end, saying so, so a large change still fits one message. */
function truncate(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  const cut = Buffer.from(text).subarray(0, max).toString('utf8');
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n… (diff truncated)`;
}

/**
 * AI commit message drafts (27 §7.3, D110): a short read-only attempt the request waits for, stopped after
 * the setting `git.commitDraftTimeoutSeconds`. The draft only fills the user's input; nothing is committed.
 */
export function createCommitDrafts({ clock, log, attempts, projects, roles, settings, prompts }: CommitDraftsDeps) {
  /** Drafts submitted by attempts still running, and the requests waiting for them. */
  const submitted = new Map<string, CommitDraft>();
  const waiting = new Map<string, (attempt: AttemptDTO) => void>();

  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended' || attempt.kind !== AttemptKind.CommitMessage) return;
    waiting.get(attempt.id)?.(attempts.get(attempt.id));
  });

  /** What the draft describes: the staged changes, or what merging `from` into `to` brings. */
  async function describe(repo: string, range: { from: string; to: string } | undefined) {
    if (range === undefined) {
      if (!(await hasStagedChanges(repo))) {
        throw new AppError(ErrorCode.GitNothingToCommit, 'Nothing is staged', { path: repo });
      }
      const diff = await runGit(['diff', '--cached', '--stat', '--patch'], { cwd: repo });
      return { scope: 'the staged changes', diff: diff.stdout };
    }
    const base = await mergeBase(repo, range.to, range.from);
    const [subjects, diff] = await Promise.all([
      runGit(['log', '--format=- %s', `${base}..${range.from}`], { cwd: repo }),
      runGit(['diff', '--stat', '--patch', base, range.from], { cwd: repo }),
    ]);
    return {
      scope: `squashing ${range.from} into ${range.to} (its commits:\n${subjects.stdout})`,
      diff: diff.stdout,
    };
  }

  return {
    async draft(projectId: string, range: { from: string; to: string } | undefined): Promise<CommitDraft> {
      const project = projects.getRecord(projectId);
      attempts.requireReady();
      const { scope, diff } = await describe(project.repoPath, range);
      const recent = await runGit(['log', `--max-count=${RECENT_SUBJECTS}`, '--format=- %s'], {
        cwd: project.repoPath,
        okExitCodes: [0, 128],
      });
      const reviewer = roles.getByKey(BuiltinRoleKey.Reviewer);
      const attemptId = randomUUID();
      const ended = new Promise<AttemptDTO>((resolve) => waiting.set(attemptId, resolve));
      // Not waited on forever: the request is someone at the commit box (27 §7.3).
      const cancelTimer = clock.schedule(settings.get('git.commitDraftTimeoutSeconds') * 1000, () => {
        // The timer has no caller to report to; the attempt may have ended in the meantime.
        attempts.abort(attemptId).catch((err: unknown) => log.warn({ err, attemptId }, 'commit draft abort failed'));
      });
      try {
        await attempts.start({
          id: attemptId,
          kind: AttemptKind.CommitMessage,
          agent: SessionAgent.CodeReviewer,
          projectId: project.id,
          taskId: null,
          nodeId: null,
          roleId: reviewer.id,
          directory: project.repoPath,
          title: `Commit message · ${project.name}`,
          model: reviewer.model ?? settings.get('ai.defaultModel'),
          prompt: renderTemplate(prompts[PromptName.StartCommitMessage], {
            projectName: project.name,
            scope,
            recentSubjects: recent.exitCode === 0 ? recent.stdout : 'None.',
            diff: truncate(diff, COMMIT_DRAFT_DIFF_MAX_BYTES),
          }),
        });
        const attempt = await ended;
        const draft = submitted.get(attemptId);
        if (attempt.status !== AttemptStatus.Succeeded || draft === undefined) {
          throw new AppError(ErrorCode.CommitDraftFailed, 'The AI did not draft a commit message', {
            attemptId,
            ...(attempt.error === null ? {} : { error: attempt.error }),
          });
        }
        return draft;
      } finally {
        cancelTimer();
        waiting.delete(attemptId);
        submitted.delete(attemptId);
      }
    },

    /** `submit_commit_message` (27 §7.3). */
    submit(attempt: AttemptDTO, input: SubmitCommitMessageInput): void {
      submitted.set(attempt.id, { subject: input.subject, body: input.body ?? '' });
      attempts.markSubmitted(attempt.id);
    },
  };
}
export type CommitDrafts = ReturnType<typeof createCommitDrafts>;
