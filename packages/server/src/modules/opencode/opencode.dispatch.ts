import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppError,
  ErrorCode,
  IMAGE_ANALYSIS_CLEANUP_TIMEOUT_MS,
  OPENCODE_APPROVER_AGENT,
  OPENCODE_ASSISTANT_AGENT,
  OPENCODE_COMPANION_AGENT,
  OPENCODE_DATABASE_INVESTIGATOR_AGENT,
  OPENCODE_DOCUMENT_AGENT,
  OPENCODE_IMAGE_AGENT,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import type { CreateSessionInput, OpencodeClient } from './opencode.client.ts';
import { OpencodeEventType } from './opencode.events.ts';

export const SessionPurpose = {
  Attempt: 'attempt',
  Knowledge: 'knowledge',
  Deck: 'deck',
  Design: 'design',
  Initiative: 'initiative',
  PlanningRevision: 'planning-revision',
  Assistant: 'assistant',
  Approval: 'approval',
  ContextSummary: 'context-summary',
  Document: 'document',
  Image: 'image',
  Companion: 'companion',
  DatabaseInvestigation: 'database-investigation',
} as const;

const dispatchPolicies = {
  [SessionPurpose.Attempt]: { lifetime: 'attempt', slot: 'owner' },
  [SessionPurpose.Knowledge]: { lifetime: 'attempt', slot: 'owner', reuse: 'when_available' },
  [SessionPurpose.Deck]: { lifetime: 'attempt', slot: 'owner', reuse: 'when_available' },
  [SessionPurpose.Design]: { lifetime: 'attempt', slot: 'owner', reuse: 'fresh' },
  [SessionPurpose.Initiative]: { lifetime: 'attempt', slot: 'owner', reuse: 'when_available' },
  [SessionPurpose.PlanningRevision]: { lifetime: 'attempt', slot: 'owner', reuse: 'required' },
  [SessionPurpose.Assistant]: { lifetime: 'object', slot: 'owner', agent: OPENCODE_ASSISTANT_AGENT },
  [SessionPurpose.ContextSummary]: {
    lifetime: 'call',
    slot: 'exclusive',
    agent: OPENCODE_DOCUMENT_AGENT,
    prefix: 'aw-summary-',
  },
  [SessionPurpose.Approval]: {
    lifetime: 'call',
    slot: 'borrowOrExclusive',
    agent: OPENCODE_APPROVER_AGENT,
    prefix: 'aw-approval-',
  },
  [SessionPurpose.Document]: {
    lifetime: 'call',
    slot: 'borrowOrExclusive',
    agent: OPENCODE_DOCUMENT_AGENT,
    prefix: 'aw-document-',
  },
  [SessionPurpose.Image]: {
    lifetime: 'call',
    slot: 'borrowOrExclusive',
    agent: OPENCODE_IMAGE_AGENT,
    prefix: 'aw-image-reader-',
    cleanupTimeoutMs: IMAGE_ANALYSIS_CLEANUP_TIMEOUT_MS,
  },
  [SessionPurpose.Companion]: {
    lifetime: 'call',
    slot: 'optional',
    agent: OPENCODE_COMPANION_AGENT,
    abortOnCleanup: true,
  },
  [SessionPurpose.DatabaseInvestigation]: {
    lifetime: 'object',
    slot: 'borrowOrExclusive',
    agent: OPENCODE_DATABASE_INVESTIGATOR_AGENT,
  },
} as const;
type Purpose = keyof typeof dispatchPolicies;
type RetainedPurpose =
  | typeof SessionPurpose.Attempt
  | typeof SessionPurpose.Assistant
  | typeof SessionPurpose.DatabaseInvestigation;
export type ObjectAttemptPurpose =
  | typeof SessionPurpose.Knowledge
  | typeof SessionPurpose.Deck
  | typeof SessionPurpose.Design
  | typeof SessionPurpose.Initiative
  | typeof SessionPurpose.PlanningRevision;
type Owner = { purpose: RetainedPurpose; ownerId: string };
type Slot = { kind: 'exclusive' } | { kind: 'optional' } | { kind: 'delegated'; parentSignal: AbortSignal };
type DispatchPolicy = { slot: Slot; signal?: AbortSignal };
type Session = { sessionId: string; directory: string; signal: AbortSignal };
type Call = { title: string; signal?: AbortSignal; parentSignal?: AbortSignal } & (
  | { purpose: typeof SessionPurpose.Approval | typeof SessionPurpose.Document | typeof SessionPurpose.Image }
  | { purpose: typeof SessionPurpose.ContextSummary; sourceDirectory: string; sourceSessionId: string; model: string }
  | { purpose: typeof SessionPurpose.Companion; directory: string }
);

type ObjectSession = {
  ownerId: string;
  directory: string;
  readSession(): string | undefined;
};
type ObjectTurn = ObjectSession & {
  purpose: typeof SessionPurpose.DatabaseInvestigation;
  title: string;
  permission?: CreateSessionInput['permission'];
  signal?: AbortSignal;
  parentSignal?: AbortSignal;
  saveSession(sessionId: string): void;
};

type ObjectActivity = {
  directory: string;
  stop: AbortController;
  tail: Promise<void>;
  ending?: Promise<void>;
};

const DENY_ALL = [{ permission: '*', pattern: '*', action: 'deny' }] satisfies CreateSessionInput['permission'];
const cleanupDefault = 5_000;

export function createSessionDispatcher({
  opencode,
  slots,
  clock,
  log,
}: {
  opencode: OpencodeClient;
  slots: Pick<ModelSlots, 'holdImmediate' | 'isFree'>;
  clock: Clock;
  log: Logger;
}) {
  const shutdown = new AbortController();
  const running = new Set<Promise<unknown>>();
  const delegationTails = new Map<AbortSignal, Promise<void>>();
  const objects = new Map<string, ObjectActivity>();

  async function release(
    sessionId: string,
    directory: string,
    interrupted: boolean,
    cleanupTimeoutMs = cleanupDefault,
    remove = true,
  ) {
    if (!opencode.isConnected()) return;
    const deadline = new AbortController();
    const cancel = clock.schedule(cleanupTimeoutMs, () => deadline.abort());
    const request = { sessionId, directory, signal: deadline.signal };
    try {
      try {
        if (interrupted) await opencode.abort(request);
      } finally {
        if (remove) await opencode.deleteSession(request);
      }
    } finally {
      cancel();
    }
  }

  async function withSlot<T>(slot: Slot, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let returnSlot: (() => void) | undefined;
    if (slot.kind === 'exclusive') returnSlot = slots.holdImmediate();
    if ((slot.kind === 'exclusive' && returnSlot === undefined) || (slot.kind === 'optional' && !slots.isFree()))
      throw new AppError(ErrorCode.ModelSlotsFull, 'This call needs a free model slot');
    try {
      return await run();
    } finally {
      returnSlot?.();
    }
  }

  function dispatch<T>(policy: DispatchPolicy, run: (signal: AbortSignal) => Promise<T>, objectSignal?: AbortSignal) {
    const lifetime = new AbortController();
    const unsubscribe = opencode.subscribe((event) => {
      if (event.type === OpencodeEventType.RuntimeLost) lifetime.abort();
    });
    const parent = policy.slot.kind === 'delegated' ? policy.slot.parentSignal : undefined;
    const signal = AbortSignal.any([
      shutdown.signal,
      lifetime.signal,
      ...(policy.signal === undefined ? [] : [policy.signal]),
      ...(parent === undefined ? [] : [parent]),
      ...(objectSignal === undefined ? [] : [objectSignal]),
    ]);
    const previous = parent === undefined ? undefined : delegationTails.get(parent);
    const invoke = () => withSlot(policy.slot, signal, () => run(signal));
    const result = previous === undefined ? invoke() : previous.then(invoke);
    if (parent !== undefined) {
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      delegationTails.set(parent, tail);
      void tail.then(() => {
        if (delegationTails.get(parent) === tail) delegationTails.delete(parent);
      });
    }
    const pending = result.finally(() => {
      unsubscribe();
      running.delete(pending);
    });
    running.add(pending);
    return pending;
  }

  function slotFor(purpose: Purpose, parentSignal: AbortSignal | undefined): Slot {
    const slot = dispatchPolicies[purpose].slot;
    if (slot === 'exclusive') return { kind: 'exclusive' };
    if (slot === 'optional') return { kind: 'optional' };
    if (slot === 'borrowOrExclusive')
      return parentSignal === undefined ? { kind: 'exclusive' } : { kind: 'delegated', parentSignal };
    throw new Error('Retained owner manages its own queued slot');
  }

  /** Retained sessions are bound once; their owners record IDs and own restart/recovery policy. */
  function bind({
    purpose,
    ownerId,
    input,
    existing,
    after,
  }: Owner &
    (
      | { input: CreateSessionInput; existing?: string; after?: Promise<unknown> }
      | { input?: never; existing: string; after?: Promise<unknown> }
    )) {
    const policy = dispatchPolicies[purpose];
    const open = () => {
      shutdown.signal.throwIfAborted();
      if (existing !== undefined) {
        log.debug({ purpose, ownerId, sessionId: existing }, 'model session resumed');
        return existing;
      }
      if (input === undefined) throw new Error('Missing retained session creation parameters');
      log.debug({ purpose, ownerId }, 'opening model session');
      return opencode.createSession({ ...input, ...('agent' in policy ? { agent: policy.agent } : {}) });
    };
    return after === undefined ? open() : after.then(open);
  }

  async function finishTurn(purpose: Purpose, { sessionId, directory, signal }: Session) {
    const policy = dispatchPolicies[purpose];
    const remove = policy.lifetime === 'call';
    if (!remove && !signal.aborted) return;
    try {
      await release(
        sessionId,
        directory,
        signal.aborted || ('abortOnCleanup' in policy && policy.abortOnCleanup),
        'cleanupTimeoutMs' in policy ? policy.cleanupTimeoutMs : cleanupDefault,
        remove,
      );
    } catch (error) {
      log.warn({ err: error, purpose, sessionId }, 'model session cleanup failed');
    }
  }

  function callPrepared<T, Prepared>(
    input: Call,
    run: (session: Session, prepared: Prepared) => Promise<T>,
    prepare: (signal: AbortSignal) => Promise<Prepared>,
  ): Promise<T> {
    const policy = dispatchPolicies[input.purpose];
    const slot = slotFor(input.purpose, input.parentSignal);
    return dispatch({ slot, ...(input.signal === undefined ? {} : { signal: input.signal }) }, async (signal) => {
      const prepared = await prepare(signal);
      signal.throwIfAborted();
      const directory =
        'directory' in input ? input.directory : await mkdtemp(join(tmpdir(), dispatchPolicies[input.purpose].prefix));
      try {
        signal.throwIfAborted();
        if (input.purpose === SessionPurpose.ContextSummary) {
          await opencode.prepareDelegationModel({
            sourceDirectory: input.sourceDirectory,
            sourceSessionId: input.sourceSessionId,
            model: input.model,
            targetDirectory: directory,
            signal,
            privateSession: true,
          });
          signal.throwIfAborted();
        }
        const sessionId = await opencode.createSession({
          directory,
          title: input.title,
          agent: policy.agent,
          permission: DENY_ALL,
          signal,
        });
        try {
          signal.throwIfAborted();
          return await run({ sessionId, directory, signal }, prepared);
        } finally {
          await finishTurn(input.purpose, { sessionId, directory, signal });
        }
      } finally {
        if (!('directory' in input)) await rm(directory, { recursive: true, force: true });
      }
    });
  }

  function activity({ ownerId, directory }: ObjectSession): ObjectActivity {
    const existing = objects.get(ownerId);
    if (existing !== undefined) {
      if (existing.directory !== directory)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The model session is bound to another directory');
      return existing;
    }
    const active = { directory, stop: new AbortController(), tail: Promise.resolve() };
    objects.set(ownerId, active);
    return active;
  }

  return {
    bind,
    shouldContinueAttempt(purpose: ObjectAttemptPurpose, previousSessionId: string | null) {
      const { reuse } = dispatchPolicies[purpose];
      return reuse === 'required' || (reuse === 'when_available' && previousSessionId !== null);
    },
    call<T>(input: Call, run: (session: Session) => Promise<T>) {
      return callPrepared(input, run, async () => undefined);
    },
    callPrepared,
    /** The owner persists one session ID. Serialize actual requests, including first creation, by that owner. */
    objectTurn<T>(input: ObjectTurn, run: (session: Session) => Promise<T>): Promise<T> {
      shutdown.signal.throwIfAborted();
      const active = activity(input);
      if (active.ending !== undefined)
        throw new AppError(ErrorCode.StateTransitionInvalid, 'The object session is ending');
      const result = active.tail.then(() =>
        dispatch(
          {
            slot: slotFor(input.purpose, input.parentSignal),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
          async (signal) => {
            const { ownerId, directory, title, purpose } = input;
            const { agent } = dispatchPolicies[purpose];
            await mkdir(directory, { recursive: true });
            signal.throwIfAborted();
            const existing = input.readSession();
            const sessionId = await bind({
              purpose,
              ownerId,
              ...(existing === undefined ? {} : { existing }),
              input: { directory, agent, title, permission: input.permission ?? DENY_ALL, signal },
            });
            if (existing === undefined) {
              try {
                input.saveSession(sessionId);
              } catch (error) {
                await release(sessionId, directory, true);
                throw error;
              }
            }
            try {
              signal.throwIfAborted();
              return await run({ sessionId, directory, signal });
            } finally {
              await finishTurn(purpose, { sessionId, directory, signal });
            }
          },
          active.stop.signal,
        ),
      );
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      active.tail = tail;
      void tail.then(() => {
        if (active.tail === tail && active.ending === undefined) objects.delete(input.ownerId);
      });
      return result;
    },
    endObject(input: ObjectSession): Promise<void> {
      const active = activity(input);
      active.stop.abort();
      active.ending ??= active.tail
        .then(async () => {
          const sessionId = input.readSession();
          if (sessionId !== undefined) {
            if (!opencode.isConnected())
              throw new AppError(
                ErrorCode.OpencodeNotReady,
                'The model session cannot be ended while the runtime is offline',
              );
            await release(sessionId, input.directory, true);
          }
        })
        .finally(() => objects.delete(input.ownerId));
      return active.ending;
    },
    async close(): Promise<void> {
      shutdown.abort();
      await Promise.allSettled([...running, ...[...objects.values()].map(({ tail, ending }) => ending ?? tail)]);
    },
  };
}
export type SessionDispatcher = ReturnType<typeof createSessionDispatcher>;
