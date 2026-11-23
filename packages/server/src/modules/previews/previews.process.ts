import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { basename } from 'node:path';
import {
  AppError,
  ErrorCode,
  PREVIEW_LOG_TAIL_CHARS,
  PREVIEW_PROBE_INTERVAL_MS,
  PREVIEW_SETUP_TIMEOUT_MS,
  PREVIEW_START_TIMEOUT_MS,
  type ProjectPreview,
} from '@aw/shared';
import { execa } from 'execa';
import type { Clock } from '../../core/clock.ts';
import { host } from '../../core/platform.ts';
import type { PreviewCommand } from './previews.commands.ts';

/** A preview's output: appended to its log file (when it has one) and kept as a tail for the user. */
export type PreviewLog = {
  append(text: string): void;
  tail(): string;
  position(): number;
  since(position: number): string;
  close(): void;
};

export function createPreviewLog(file: string | null, filter?: (text: string) => string): PreviewLog {
  let tail = '';
  let position = 0;
  const stream = file === null ? null : createWriteStream(file, { flags: 'a' });
  return {
    append(text) {
      const output = filter === undefined ? text : filter(text);
      position += output.length;
      tail = (tail + output).slice(-PREVIEW_LOG_TAIL_CHARS);
      stream?.write(output);
    },
    tail: () => tail,
    position: () => position,
    since: (start) => tail.slice(Math.max(0, tail.length + start - position)),
    close: () => stream?.end(),
  };
}

/** A port free right now; the dev server binds it a moment later (29 §4.3). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('Expected a TCP address'));
      else server.close(() => resolve(address.port));
    });
  });
}

export type RunningPreview = {
  port: number;
  /** Settles when the dev server exits, by itself or stopped. */
  exited: Promise<void>;
  /** Ends the dev server with everything it started (D73). */
  stop(): Promise<void>;
};

export type LaunchInput = {
  directory: string;
  config: ProjectPreview | { readyPath: string; command: (port: number) => PreviewCommand };
  onLaunch?: (info: { command: string; readyUrl: string }) => void;
  onProbe?: (status: number) => void;
  reservedPorts?: Set<number>;
  shell: string;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  log: PreviewLog;
  /** Stopping while starting: whatever runs is ended and the launch fails. */
  signal: AbortSignal;
};

function startFailed(message: string, log: PreviewLog, readyStatus?: number): AppError {
  return new AppError(ErrorCode.PreviewStartFailed, message, {
    logTail: log.tail(),
    ...(readyStatus === undefined ? {} : { readyStatus }),
  });
}

/** Runs a shell command line in the worktree, its output going to the log; null exit code when it was ended. */
function show(command: string | PreviewCommand): string {
  return typeof command === 'string'
    ? command
    : [basename(command.executable), ...command.args]
        .map((value) => (/\s/.test(value) ? JSON.stringify(value) : value))
        .join(' ');
}

function run(command: string | PreviewCommand, input: LaunchInput, env: NodeJS.ProcessEnv) {
  input.log.append(`$ ${show(command)}\n`);
  // Package-manager shell shims can replace a Windows process in the middle of the tree.
  // For simple package commands, use the native launcher. Shell syntax still goes through Git Bash.
  const direct =
    host.shellFromGit && typeof command === 'string'
      ? /^(npm|pnpm|yarn|bun)((?: [A-Za-z0-9_.-]+)+)$/.exec(command)
      : null;
  const manager = direct?.[1];
  const args = direct?.[2]?.trim().split(' ') ?? [];
  const executable = manager === undefined ? undefined : host.findExecutable(manager, host.pathDirs(env));
  const options = {
    cwd: typeof command === 'string' ? input.directory : (command.directory ?? input.directory),
    env,
    extendEnv: false,
    all: true,
    reject: false,
    stdin: 'ignore',
    // A shell ended alone leaves the dev server running, holding its port and the worktree's files (D73).
    killDescendants: true,
  } as const;
  const child =
    typeof command !== 'string'
      ? execa(command.executable, command.args, options)
      : executable === undefined
        ? execa(command, { ...options, shell: input.shell })
        : execa(executable, args, options);
  child.all.on('data', (chunk: Buffer) => input.log.append(chunk.toString()));
  return child;
}

/** The setup command (dependency install) a worktree runs before its first start (29 §4.1). */
export async function setUpPreview(command: string | PreviewCommand, input: LaunchInput): Promise<void> {
  if (input.signal.aborted) throw startFailed('Stopped while preparing', input.log);
  const child = run(command, input, input.env);
  const stop = () => child.kill();
  const cancelTimeout = input.clock.schedule(PREVIEW_SETUP_TIMEOUT_MS, stop);
  input.signal.addEventListener('abort', stop, { once: true });
  const result = await child;
  cancelTimeout();
  input.signal.removeEventListener('abort', stop);
  if (result.exitCode !== 0) throw startFailed(`Setup command exited with ${result.exitCode ?? 'a signal'}`, input.log);
}

/**
 * Starts on a free port. Task launchers require a successful HTTP response; configured previews accept any reply (29 §4.2).
 * The path is probed whenever the server writes output and every PREVIEW_PROBE_INTERVAL_MS; the server exiting, or
 * not becoming ready within PREVIEW_START_TIMEOUT_MS (it is ended then), fails with PREVIEW_START_FAILED.
 */
export async function launchPreview(input: LaunchInput): Promise<RunningPreview> {
  const { config, clock, log, signal } = input;
  if (signal.aborted) throw startFailed('Stopped while starting', log);

  let port = await freePort();
  while (input.reservedPorts?.has(port)) port = await freePort();
  input.reservedPorts?.add(port);
  if (signal.aborted) throw startFailed('Stopped while starting', log);
  const command =
    typeof config.command === 'string' ? config.command.replaceAll('$PORT', String(port)) : config.command(port);
  const url = `http://127.0.0.1:${port}${config.readyPath}`;
  input.onLaunch?.({ command: show(command), readyUrl: url });
  if (signal.aborted) throw startFailed('Stopped while starting', log);
  const child = run(command, input, {
    ...input.env,
    PORT: String(port),
    ...(typeof command !== 'string' ? { SERVER_PORT: String(port) } : {}),
  });
  const exited = child.then(() => undefined);
  const stop = async () => {
    child.kill();
    await exited;
  };

  const { promise: ready, resolve, reject } = Promise.withResolvers<void>();
  let reason = 'The dev server exited before it was ready';
  let readyStatus: number | undefined;
  let settled = false;
  let probing = false;
  const probeController = new AbortController();
  const probe = async () => {
    if (settled || probing) return;
    probing = true;
    try {
      const response = await fetch(url, { redirect: 'manual', signal: probeController.signal });
      await response.body?.cancel();
      if (settled || signal.aborted) return;
      readyStatus = response.status;
      input.onProbe?.(readyStatus);
      if (typeof command !== 'string' && !response.ok) {
        if (readyStatus >= 500 || readyStatus === 408 || readyStatus === 429) return;
        reason = `Readiness path returned HTTP ${readyStatus}`;
        settled = true;
        child.kill();
        reject(startFailed(reason, log, readyStatus));
        return;
      }
      settled = true;
      resolve();
    } catch {
      // Not listening yet: the next output or tick probes again.
    } finally {
      probing = false;
    }
  };
  let cancelTick = () => {};
  const tick = () => {
    void probe();
    cancelTick = clock.schedule(PREVIEW_PROBE_INTERVAL_MS, tick);
  };
  child.all.on('data', () => void probe());

  const cancelTimeout = clock.schedule(PREVIEW_START_TIMEOUT_MS, () => {
    reason = `Not ready within ${PREVIEW_START_TIMEOUT_MS} ms`;
    child.kill();
  });
  const abort = () => {
    reason = 'Stopped while starting';
    child.kill();
  };
  signal.addEventListener('abort', abort, { once: true });
  void exited.then(() => {
    if (settled) return;
    settled = true;
    reject(startFailed(reason, log, readyStatus));
  });

  tick();
  try {
    await ready;
  } catch (error) {
    await exited;
    throw error;
  } finally {
    probeController.abort();
    cancelTick();
    cancelTimeout();
    signal.removeEventListener('abort', abort);
  }
  return { port, exited, stop };
}
