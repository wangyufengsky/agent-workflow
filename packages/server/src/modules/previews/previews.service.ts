import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  ErrorCode,
  type Preview,
  PreviewEvent,
  PreviewState,
  type PreviewTrial,
  type ProjectPreview,
  previewMachine,
  ServerEventType,
  transition,
  WorktreeStatus,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import { locateShell } from '../git/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { WorktreesService } from '../worktrees/index.ts';
import {
  createPreviewLog,
  launchPreview,
  type PreviewLog,
  type RunningPreview,
  setUpPreview,
} from './previews.process.ts';

export type PreviewsServiceDeps = {
  clock: Clock;
  log: Logger;
  events: EventBus;
  env: NodeJS.ProcessEnv;
  settings: SettingsService;
  projects: ProjectsService;
  worktrees: WorktreesService;
  dataDir: string;
};

/** One task worktree's preview, in memory only (29 §4.2). */
type Entry = {
  taskId: string;
  state: PreviewState;
  log: PreviewLog | null;
  process: RunningPreview | null;
  starting: Promise<Preview> | null;
  abort: AbortController;
  /** Browser tabs using the preview; it may stop for idleness or make room only without any. */
  leases: number;
  idleSince: number;
  cancelIdle: () => void;
};

const ACTIVE: readonly PreviewState[] = [PreviewState.Starting, PreviewState.Running];

export function createPreviewsService({
  clock,
  log,
  events,
  env,
  settings,
  projects,
  worktrees,
  dataDir,
}: PreviewsServiceDeps) {
  const entries = new Map<string, Entry>();
  /** Worktrees whose setup command succeeded since the app started. */
  const setUp = new Set<string>();
  /** Tasks whose preview became ready at least once since the app started (29 §7.4). */
  const ran = new Set<string>();
  /** Page checks waiting for room under the limit (29 §4.4); woken when a preview stops or a tab lets go of one. */
  const waiting = new Set<() => void>();
  const wake = () => {
    for (const resume of waiting) resume();
    waiting.clear();
  };

  function toPreview(taskId: string, entry: Entry | undefined): Preview {
    return {
      taskId,
      state: entry?.state ?? PreviewState.Stopped,
      url: entry?.process === null || entry?.process === undefined ? null : `http://127.0.0.1:${entry.process.port}`,
      logTail: entry?.log?.tail() ?? '',
    };
  }

  function move(entry: Entry, event: PreviewEvent): void {
    const to = transition(previewMachine, entry.state, event);
    log.info({ taskId: entry.taskId, from: entry.state, to, event }, 'preview transition');
    entry.state = to;
    if (to === PreviewState.Stopped || to === PreviewState.Failed) wake();
    events.publish({ type: ServerEventType.PreviewUpdated, data: toPreview(entry.taskId, entry) });
  }

  function scheduleIdle(entry: Entry): void {
    entry.cancelIdle();
    if (entry.state !== PreviewState.Running || entry.leases > 0) return;
    entry.idleSince = clock.now();
    entry.cancelIdle = clock.schedule(settings.get('preview.idleMinutes') * 60_000, () => {
      stop(entry.taskId).catch((err: unknown) => log.error({ err, taskId: entry.taskId }, 'idle preview stop failed'));
    });
  }

  /** Resolves when room may have freed up, or when `signal` aborts. */
  const room = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const resume = () => {
        signal.removeEventListener('abort', resume);
        waiting.delete(resume);
        resolve();
      };
      waiting.add(resume);
      signal.addEventListener('abort', resume, { once: true });
    });

  /**
   * Under `preview.maxRunning` (29 §4.4): the longest-idle preview without tabs stops to make room. When every one
   * is in use, `queue` waits for room (a page check) until it aborts; otherwise PREVIEW_LIMIT_REACHED.
   */
  async function makeRoom(taskId: string, queue: AbortSignal | undefined): Promise<void> {
    for (;;) {
      const active = [...entries.values()].filter((e) => e.taskId !== taskId && ACTIVE.includes(e.state));
      if (active.length < settings.get('preview.maxRunning')) return;
      const idle = active
        .filter((e) => e.state === PreviewState.Running && e.leases === 0)
        .sort((a, b) => a.idleSince - b.idleSince)[0];
      if (idle !== undefined) {
        await stop(idle.taskId);
        return;
      }
      if (queue === undefined) {
        throw new AppError(ErrorCode.PreviewLimitReached, 'Every running preview is in use', {
          maxRunning: settings.get('preview.maxRunning'),
        });
      }
      queue.throwIfAborted();
      await room(queue);
    }
  }

  async function launch(entry: Entry, directory: string, config: ProjectPreview): Promise<Preview> {
    const taskRuns = join(dataDir, 'runs', entry.taskId);
    mkdirSync(taskRuns, { recursive: true });
    entry.log?.close();
    const previewLog = createPreviewLog(join(taskRuns, 'preview.log'));
    entry.log = previewLog;
    try {
      const input = {
        directory,
        config,
        shell: await locateShell(env),
        env,
        clock,
        log: previewLog,
        signal: entry.abort.signal,
      };
      if (config.setupCommand !== null && !setUp.has(directory)) {
        await setUpPreview(config.setupCommand, input);
        setUp.add(directory);
      }
      const running = await launchPreview(input);
      if (entry.state !== PreviewState.Starting) {
        // Stopped the moment it became ready: the stop could not end a process it did not have yet.
        await running.stop();
        throw new AppError(ErrorCode.PreviewStartFailed, 'Stopped while starting', { logTail: previewLog.tail() });
      }
      entry.process = running;
      ran.add(entry.taskId);
      move(entry, PreviewEvent.Ready);
      void running.exited.then(() => {
        // Stopping moved it out of running before ending the process.
        if (entry.process !== running || entry.state !== PreviewState.Running) return;
        entry.process = null;
        entry.cancelIdle();
        move(entry, PreviewEvent.Exited);
      });
      scheduleIdle(entry);
      return toPreview(entry.taskId, entry);
    } catch (err) {
      if (entry.state === PreviewState.Starting) move(entry, PreviewEvent.Exited);
      throw err;
    }
  }

  async function stop(taskId: string): Promise<Preview> {
    const entry = entries.get(taskId);
    if (entry === undefined) return toPreview(taskId, entry);
    entry.cancelIdle();
    if (entry.state === PreviewState.Starting) {
      move(entry, PreviewEvent.Stop);
      entry.abort.abort();
      await Promise.allSettled([entry.starting]);
    } else if (entry.state === PreviewState.Running && entry.process !== null) {
      const running = entry.process;
      entry.process = null;
      move(entry, PreviewEvent.Stop);
      await running.stop();
    }
    return toPreview(taskId, entry);
  }

  // The dev server holds the worktree's files: it ends before the worktree goes (17 §3).
  worktrees.onBeforeRemove(async (worktree) => {
    await stop(worktree.taskId);
    entries.get(worktree.taskId)?.log?.close();
    entries.delete(worktree.taskId);
    setUp.delete(worktree.path);
  });

  return {
    get: (taskId: string): Preview => toPreview(taskId, entries.get(taskId)),

    /**
     * Whether the task's preview was ever ready since the app started: a start failing after that is the change's
     * doing, before it the environment's (29 §7.4, D116).
     */
    hasRun: (taskId: string): boolean => ran.has(taskId),

    /**
     * Starts the task's preview, or joins a start in progress; resolves once it is running (29 §4.2). `queue`: wait
     * for room under the limit instead of failing (a page check, 29 §4.4).
     */
    async start(taskId: string, { queue }: { queue?: AbortSignal } = {}): Promise<Preview> {
      const existing = entries.get(taskId);
      if (existing?.state === PreviewState.Running) return toPreview(taskId, existing);
      if (existing?.starting !== null && existing?.starting !== undefined) return existing.starting;
      const worktree = worktrees.findByTask(taskId);
      if (worktree?.status !== WorktreeStatus.Ready) {
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The task has no worktree to preview', {
          entity: 'preview',
          taskId,
        });
      }
      const { preview } = projects.getRecord(worktree.projectId);
      if (preview === null) {
        throw new AppError(ErrorCode.PreviewNotConfigured, 'The project has no page preview', {
          projectId: worktree.projectId,
        });
      }
      await makeRoom(taskId, queue);
      const entry: Entry = existing ?? {
        taskId,
        state: PreviewState.Stopped,
        log: null,
        process: null,
        starting: null,
        abort: new AbortController(),
        leases: 0,
        idleSince: clock.now(),
        cancelIdle: () => {},
      };
      entries.set(taskId, entry);
      move(entry, PreviewEvent.Start);
      entry.abort = new AbortController();
      const starting = launch(entry, worktree.path, preview);
      entry.starting = starting;
      try {
        return await starting;
      } finally {
        entry.starting = null;
      }
    },

    stop,

    /** A browser tab starts using the preview: it no longer stops for idleness (29 §4.2). */
    acquire(taskId: string): void {
      const entry = entries.get(taskId);
      if (entry === undefined) return;
      entry.leases += 1;
      entry.cancelIdle();
    },

    release(taskId: string): void {
      const entry = entries.get(taskId);
      if (entry === undefined) return;
      entry.leases -= 1;
      scheduleIdle(entry);
      if (entry.leases === 0) wake();
    },

    /** Starts the project's preview once in its main workspace, without the setup command, and stops it again. */
    async trial(projectId: string): Promise<PreviewTrial> {
      const project = projects.getRecord(projectId);
      if (project.preview === null) {
        throw new AppError(ErrorCode.PreviewNotConfigured, 'The project has no page preview', { projectId });
      }
      const trialLog = createPreviewLog(null);
      const running = await launchPreview({
        directory: project.repoPath,
        config: project.preview,
        shell: await locateShell(env),
        env,
        clock,
        log: trialLog,
        signal: new AbortController().signal,
      });
      await running.stop();
      return { url: `http://127.0.0.1:${running.port}`, logTail: trialLog.tail() };
    },

    /** Application exit: every dev server ends with the backend. */
    async stopAll(): Promise<void> {
      await Promise.all([...entries.keys()].map((taskId) => stop(taskId)));
    },
  };
}

export type PreviewsService = ReturnType<typeof createPreviewsService>;
