import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
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

/** A preview's output: appended to its log file (when it has one) and kept as a tail for the user. */
export type PreviewLog = { append(text: string): void; tail(): string; close(): void };

export function createPreviewLog(file: string | null): PreviewLog {
  let tail = '';
  const stream = file === null ? null : createWriteStream(file, { flags: 'a' });
  return {
    append(text) {
      tail = (tail + text).slice(-PREVIEW_LOG_TAIL_CHARS);
      stream?.write(text);
    },
    tail: () => tail,
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
  config: ProjectPreview;
  shell: string;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  log: PreviewLog;
  /** Stopping while starting: whatever runs is ended and the launch fails. */
  signal: AbortSignal;
};

function startFailed(message: string, log: PreviewLog): AppError {
  return new AppError(ErrorCode.PreviewStartFailed, message, { logTail: log.tail() });
}

/** Runs a shell command line in the worktree, its output going to the log; null exit code when it was ended. */
function run(command: string, input: LaunchInput, env: NodeJS.ProcessEnv) {
  input.log.append(`$ ${command}\n`);
  const child = execa(command, {
    cwd: input.directory,
    // The same POSIX shell as check commands on every platform (D73).
    shell: input.shell,
    env,
    extendEnv: false,
    all: true,
    reject: false,
    stdin: 'ignore',
    // A shell ended alone leaves the dev server running, holding its port and the worktree's files (D73).
    killDescendants: true,
  });
  child.all.on('data', (chunk: Buffer) => input.log.append(chunk.toString()));
  return child;
}

/** The setup command (dependency install) a worktree runs before its first start (29 §4.1). */
export async function setUpPreview(command: string, input: LaunchInput): Promise<void> {
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
 * Starts the dev server on a free port and resolves once its ready path answers with any HTTP response (29 §4.2).
 * The path is probed whenever the server writes output and every PREVIEW_PROBE_INTERVAL_MS; the server exiting, or
 * not becoming ready within PREVIEW_START_TIMEOUT_MS (it is ended then), fails with PREVIEW_START_FAILED.
 */
export async function launchPreview(input: LaunchInput): Promise<RunningPreview> {
  const { config, clock, log, signal } = input;
  if (signal.aborted) throw startFailed('Stopped while starting', log);

  const port = await freePort();
  const child = run(config.command.replaceAll('$PORT', String(port)), input, { ...input.env, PORT: String(port) });
  const exited = child.then(() => undefined);
  const stop = async () => {
    child.kill();
    await exited;
  };

  const { promise: ready, resolve, reject } = Promise.withResolvers<void>();
  const url = `http://127.0.0.1:${port}${config.readyPath}`;
  let settled = false;
  let probing = false;
  const probe = async () => {
    if (settled || probing) return;
    probing = true;
    try {
      await fetch(url, { redirect: 'manual' });
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

  let reason = 'The dev server exited before it was ready';
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
    reject(startFailed(reason, log));
  });

  tick();
  try {
    await ready;
  } finally {
    cancelTick();
    cancelTimeout();
    signal.removeEventListener('abort', abort);
  }
  return { port, exited, stop };
}
