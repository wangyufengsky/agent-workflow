import { createWriteStream, mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppError,
  ErrorCode,
  OPENCODE_LOG_FILE_PATTERN,
  OPENCODE_START_TIMEOUT_MS,
  OPENCODE_VERSION,
  opencodeLogFile,
  type RuntimeDTO,
  RuntimeEvent,
  type RuntimeLogsDTO,
  RuntimeStatus,
  runtimeMachine,
  ServerEventType,
  transition,
} from '@aw/shared';
import { createOpencodeClient, type OpencodeClient as Sdk } from '@opencode-ai/sdk/v2';
import { execa } from 'execa';
import type { Clock } from '../../core/clock.ts';
import type { EventBus } from '../../core/event-bus.ts';
import { dateStamp, type Logger } from '../../core/logger.ts';
import { detectOpencode } from './opencode.binary.ts';

export type OpencodeRuntimeDeps = {
  env: NodeJS.ProcessEnv;
  /** Setting `opencode.binaryPath`, read at each detection. */
  binaryPath: () => string | null;
  /**
   * `OPENCODE_CONFIG_CONTENT` for the next launch (12 §2); built per launch because it holds the MCP endpoint.
   * Rejects when opencode cannot be hosted safely here (no Git Bash on Windows, D67).
   */
  configContent: () => Promise<string>;
  log: Logger;
  events: EventBus;
  clock: Clock;
  logDir: string;
};

const SERVE_ARGS = ['serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'WARN'];

function spawnServe(path: string, env: NodeJS.ProcessEnv) {
  return execa(path, SERVE_ARGS, {
    env,
    extendEnv: false,
    stdin: 'ignore',
    buffer: false,
    reject: false,
    // Stopping ends its bash commands and language servers too: on Windows they would outlive it, holding worktree
    // files (D68).
    killDescendants: true,
  });
}

type Exit = { code: number | undefined; signal: string | undefined };
type Process = {
  child: ReturnType<typeof spawnServe>;
  expectedExit: boolean;
  exited: Promise<Exit>;
  /** Ends the global event subscription of this process. */
  events: AbortController;
};

const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

/**
 * Hosts one `opencode serve` (D09) and drives the runtime state machine (09 §9).
 * An unexpected exit is restarted automatically once; afterwards only a manual start (re)arms it.
 */
export function createOpencodeRuntime(deps: OpencodeRuntimeDeps) {
  const { log, clock } = deps;
  let state: RuntimeDTO | undefined;
  let proc: Process | undefined;
  let sdk: Sdk | undefined;
  let autoRestartArmed = true;
  const lostListeners = new Set<() => void>();
  const eventListeners = new Set<(raw: unknown) => void>();

  function setState(next: RuntimeDTO): void {
    state = next;
    deps.events.publish({ type: ServerEventType.RuntimeUpdated, data: next });
  }

  async function detect(): Promise<RuntimeDTO> {
    const detected = await detectOpencode(deps.env, deps.binaryPath());
    return { ...detected, requiredVersion: OPENCODE_VERSION };
  }

  async function snapshot(): Promise<RuntimeDTO> {
    state ??= await detect();
    return state;
  }

  /** The executable of a hostable (detected, right version) runtime. */
  function located(s: RuntimeDTO): { path: string; version: string } {
    if (s.status === RuntimeStatus.NotInstalled) throw new Error('opencode is not installed');
    return { path: s.path, version: s.version };
  }

  function openLog() {
    mkdirSync(deps.logDir, { recursive: true });
    return createWriteStream(join(deps.logDir, opencodeLogFile(dateStamp(clock.now()))), { flags: 'a' });
  }

  /** Spawns `opencode serve` and resolves with its address; rejects if it exits or stays silent too long. */
  function launch(path: string, configContent: string): { launched: Process; address: Promise<string> } {
    const child = spawnServe(path, { ...deps.env, OPENCODE_CONFIG_CONTENT: configContent });
    const logFile = openLog();
    const launched: Process = {
      child,
      expectedExit: false,
      exited: child.then((result) => ({ code: result.exitCode, signal: result.signal })),
      events: new AbortController(),
    };
    const address = new Promise<string>((resolve, reject) => {
      let seen = '';
      let found = false;
      const cancelTimeout = clock.schedule(OPENCODE_START_TIMEOUT_MS, () =>
        reject(new Error('opencode did not report its address in time')),
      );
      const onOutput = (chunk: Buffer) => {
        logFile.write(chunk);
        if (found) return;
        seen += chunk.toString();
        const match = LISTENING.exec(seen);
        if (match?.[1] === undefined) return;
        found = true;
        cancelTimeout();
        resolve(match[1]);
      };
      child.stdout.on('data', onOutput);
      child.stderr.on('data', onOutput);
      void launched.exited.then(({ code, signal }) => {
        cancelTimeout();
        logFile.end();
        reject(new Error(`opencode exited during start (code ${code}, signal ${signal})`));
      });
    });
    return { launched, address };
  }

  /** Forwards opencode's global event stream (D34) until the process goes away. */
  async function pumpEvents(client: Sdk, owner: Process): Promise<void> {
    const { signal } = owner.events;
    try {
      const { stream } = await client.global.event({ signal });
      for await (const raw of stream) for (const listener of eventListeners) listener(raw);
    } catch (err) {
      // Aborting is how the subscription ends when the process stops; anything else loses events and is logged.
      if (!signal.aborted) log.error({ err }, 'opencode event stream failed');
    }
  }

  function onExit(exited: Process, { code, signal }: Exit): void {
    exited.events.abort();
    if (exited !== proc || exited.expectedExit) return;
    proc = undefined;
    sdk = undefined;
    const current = state;
    if (current === undefined) throw new Error('runtime exited before it was detected');
    const wasReady = current.status === RuntimeStatus.Ready;
    transition(runtimeMachine, current.status, RuntimeEvent.Exited);
    setState({ status: RuntimeStatus.Crashed, ...located(current), requiredVersion: OPENCODE_VERSION });
    if (wasReady) for (const listener of lostListeners) listener();
    if (!autoRestartArmed) {
      log.error({ code, signal }, 'opencode exited; waiting for a manual restart');
      return;
    }
    autoRestartArmed = false;
    log.warn({ code, signal }, 'opencode exited; restarting once');
    void boot(RuntimeEvent.Start);
  }

  /** `start` / `restart` → starting → ready, or crashed through `onExit` when the process does not come up. */
  async function boot(event: typeof RuntimeEvent.Start | typeof RuntimeEvent.Restart): Promise<RuntimeDTO> {
    const current = await snapshot();
    transition(runtimeMachine, current.status, event);
    const { path, version } = located(current);
    if (proc !== undefined) {
      // Restart: sessions on the old process are gone, so their attempts are interrupted first (09 §9).
      for (const listener of lostListeners) listener();
      await stopProcess();
    }
    setState({ status: RuntimeStatus.Starting, path, version, requiredVersion: OPENCODE_VERSION });
    let configContent: string;
    try {
      configContent = await deps.configContent();
    } catch (err) {
      // Recovery with a defined meaning: opencode cannot be hosted here, so it does not start; the log says why.
      log.error({ err }, 'opencode configuration failed');
      transition(runtimeMachine, RuntimeStatus.Starting, RuntimeEvent.Exited);
      setState({ status: RuntimeStatus.Crashed, path, version, requiredVersion: OPENCODE_VERSION });
      return snapshot();
    }
    const { launched, address } = launch(path, configContent);
    proc = launched;
    void launched.exited.then((exit) => onExit(launched, exit));
    try {
      const url = await address;
      const client = createOpencodeClient({ baseUrl: url, throwOnError: true });
      await client.config.get();
      transition(runtimeMachine, RuntimeStatus.Starting, RuntimeEvent.Listening);
      sdk = client;
      void pumpEvents(client, launched);
      setState({
        status: RuntimeStatus.Ready,
        path,
        version,
        url,
        startedAt: clock.now(),
        requiredVersion: OPENCODE_VERSION,
      });
      log.info({ url, pid: launched.child.pid }, 'opencode ready');
    } catch (err) {
      // Recovery with a defined meaning: a launch that does not come up is killed and recorded as crashed by onExit.
      log.warn({ err }, 'opencode failed to start');
      launched.child.kill();
      await launched.exited;
    }
    return snapshot();
  }

  async function stopProcess(): Promise<void> {
    const current = proc;
    if (current === undefined) return;
    current.expectedExit = true;
    proc = undefined;
    sdk = undefined;
    current.events.abort();
    current.child.kill();
    await current.exited;
  }

  return {
    snapshot,
    /** Re-detects opencode while it is not hostable (`recheck`); a hostable runtime is left as it is. */
    async recheck(): Promise<RuntimeDTO> {
      const current = await snapshot();
      if (current.status !== RuntimeStatus.NotInstalled && current.status !== RuntimeStatus.VersionMismatch) {
        return current;
      }
      const detected = await detect();
      transition(runtimeMachine, current.status, RuntimeEvent.Recheck, detected.status);
      setState(detected);
      return detected;
    },
    /** Starts a stopped runtime (backend startup); a no-op when opencode is not hostable. */
    async startIfStopped(): Promise<void> {
      if ((await snapshot()).status === RuntimeStatus.Stopped) await boot(RuntimeEvent.Start);
    },
    /** User action on the runtime page: restart a ready runtime or start a crashed / stopped one. */
    async restart(): Promise<RuntimeDTO> {
      autoRestartArmed = true;
      const { status } = await snapshot();
      return boot(status === RuntimeStatus.Ready ? RuntimeEvent.Restart : RuntimeEvent.Start);
    },
    /** The last lines of the newest opencode log (11 §2 `/system/runtime/logs`). */
    async logTail(lines: number): Promise<RuntimeLogsDTO> {
      let names: string[];
      try {
        names = await readdir(deps.logDir);
      } catch (err) {
        // Recovery with a defined meaning: opencode never ran with this data directory, so there is no log yet.
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return { file: null, lines: [] };
        throw err;
      }
      const file = names
        .filter((n) => OPENCODE_LOG_FILE_PATTERN.test(n))
        .sort()
        .at(-1);
      if (file === undefined) return { file: null, lines: [] };
      const text = await readFile(join(deps.logDir, file), 'utf8');
      return { file, lines: text.replace(/\n$/, '').split('\n').slice(-lines) };
    },
    /** Stops the process for good (backend shutdown); no state transition. */
    stop: stopProcess,
    /** SDK client of the ready runtime. */
    sdk(): Sdk {
      if (sdk === undefined) throw new AppError(ErrorCode.OpencodeNotReady, 'opencode is not ready');
      return sdk;
    },
    isReady: () => sdk !== undefined,
    processId: (): number | undefined => proc?.child.pid,
    /** Raw events of opencode's global stream; parsed by the client. */
    onEvent(listener: (raw: unknown) => void): () => void {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    /** Called when a ready runtime goes away (crash or restart): its sessions no longer exist. */
    onLost(listener: () => void): () => void {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
  };
}
export type OpencodeRuntime = ReturnType<typeof createOpencodeRuntime>;
