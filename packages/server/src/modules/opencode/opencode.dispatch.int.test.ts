import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, OPENCODE_DATABASE_INVESTIGATOR_AGENT } from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { systemClock } from '../../core/clock.ts';
import { createSessionDispatcher, SessionPurpose } from './opencode.dispatch.ts';

it('borrows a full parent slot, serializes retained turns and reuses the stored session across dispatchers', async () => {
  const test = await createTestApp();
  const create = () =>
    createSessionDispatcher({
      opencode: test.fake,
      log: test.app.log,
      clock: systemClock,
      slots: { holdImmediate: () => undefined, isFree: () => false },
    });
  let dispatcher = create();
  const directory = await mkdtemp(join(tmpdir(), 'aw-retained-session-'));
  const parent = new AbortController();
  let stored: string | undefined;
  const options = {
    ownerId: 'investigation:one',
    directory,
    purpose: SessionPurpose.DatabaseInvestigation,
    title: 'Read only investigation',
    parentSignal: parent.signal,
    readSession: () => stored,
    saveSession: (id: string) => {
      stored = id;
    },
  };
  const firstStarted = Promise.withResolvers<void>();
  const finishFirst = Promise.withResolvers<void>();
  try {
    const first = dispatcher.objectTurn(options, async ({ sessionId }) => {
      firstStarted.resolve();
      await finishFirst.promise;
      return sessionId;
    });
    const second = dispatcher.objectTurn(options, async ({ sessionId }) => sessionId);
    await firstStarted.promise;
    expect(test.fake.sessions.filter(({ agent }) => agent === OPENCODE_DATABASE_INVESTIGATOR_AGENT)).toHaveLength(1);
    finishFirst.resolve();
    const id = await first;
    expect(await second).toBe(id);

    const resumed = Promise.withResolvers<void>();
    const cancelling = dispatcher.objectTurn(options, async ({ signal }) => {
      resumed.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    });
    const cancelled = expect(cancelling).rejects.toMatchObject({ name: 'AbortError' });
    await resumed.promise;
    parent.abort();
    await cancelled;
    expect(test.fake.aborts).toContain(id);
    expect(test.fake.sessions.some((session) => session.id === id)).toBe(true);

    await dispatcher.close();
    expect(test.fake.sessions.some((session) => session.id === id)).toBe(true);
    dispatcher = create();
    expect(
      await dispatcher.objectTurn(
        { ...options, parentSignal: new AbortController().signal },
        async ({ sessionId }) => sessionId,
      ),
    ).toBe(id);
    await dispatcher.endObject(options);
    expect(test.fake.sessions.some((session) => session.id === id)).toBe(false);
    await expect(access(directory)).resolves.toBeUndefined();
  } finally {
    finishFirst.resolve();
    await dispatcher.close();
    await test.close();
  }
});

it('cancels a borrowed child with its parent and removes its scratch directory without requesting a free slot', async () => {
  const test = await createTestApp();
  const dispatcher = createSessionDispatcher({
    opencode: test.fake,
    log: test.app.log,
    clock: systemClock,
    slots: { holdImmediate: () => undefined, isFree: () => false },
  });
  const parent = new AbortController();
  const opened = Promise.withResolvers<{ sessionId: string; directory: string }>();
  try {
    const input = { purpose: SessionPurpose.Document, title: 'Read only document' };
    await expect(dispatcher.call(input, async () => null)).rejects.toMatchObject({
      code: ErrorCode.ModelSlotsFull,
    });
    const pending = dispatcher.call(
      { ...input, parentSignal: parent.signal },
      async ({ sessionId, directory, signal }) => {
        opened.resolve({ sessionId, directory });
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const { sessionId, directory } = await opened.promise;
    parent.abort();
    await rejection;
    expect(test.fake.aborts).toContain(sessionId);
    expect(test.fake.sessions.some(({ id }) => id === sessionId)).toBe(false);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await dispatcher.close();
    await test.close();
  }
});
