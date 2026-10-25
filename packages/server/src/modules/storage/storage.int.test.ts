import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cancelTaskOp, cleanStorageOp, getStorageOp, STORAGE_KEEP_DAYS, StorageKind } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { addProject, createTask } from '../../../test/helpers/tasks.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
let clock: ReturnType<typeof createFakeClock>;
let t: TestApp;
beforeEach(async () => {
  clock = createFakeClock(Date.UTC(2026, 9, 1));
  t = await createTestApp({ clock });
});
afterEach(() => t.close());

async function writeAt(path: string, bytes: number, mtimeMs: number): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, 'x'.repeat(bytes));
  await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
}

const bytesOf = (body: { items: Array<{ kind: StorageKind; bytes: number }> }, kind: StorageKind) =>
  body.items.find((i) => i.kind === kind)?.bytes;

describe('占用空间与清理（37）', () => {
  it('按类别统计数据目录，旧日志清理时保留每类最新的一个', async () => {
    const logs = join(t.dataDir, 'logs');
    const old = clock.now() - (STORAGE_KEEP_DAYS + 1) * DAY_MS;
    await writeAt(join(logs, 'opencode-20260901.log'), 300, old);
    await writeAt(join(logs, 'opencode-20260902.log'), 200, old + 1000);
    await writeAt(join(logs, 'app-20260901.log'), 50, old);
    await writeAt(join(t.dataDir, 'attachments', 'a1', 'original'), 70, clock.now());

    const { body } = await t.call(getStorageOp, {});
    expect(body.dataDir).toBe(t.dataDir);
    expect(body.items.map((i) => i.kind)).toEqual(Object.values(StorageKind));
    expect(bytesOf(body, StorageKind.Attachments)).toBe(70);
    expect(bytesOf(body, StorageKind.Database)).toBeGreaterThan(0);
    expect(body.totalBytes).toBe(body.items.reduce((sum, i) => sum + i.bytes, 0));
    // The newest opencode log is in use; the only app log is the newest of its kind (the test app writes none).
    expect(body.cleanable).toContainEqual({ target: 'logs', count: 1, bytes: 300 });

    const cleaned = await t.call(cleanStorageOp, { target: 'logs' });
    expect(cleaned.body.freedBytes).toBe(300);
    expect((await readdir(logs)).sort()).toEqual(['app-20260901.log', 'opencode-20260902.log']);
    expect(cleaned.body.storage.cleanable).toContainEqual({ target: 'logs', count: 0, bytes: 0 });
  });

  it('只清理结束超过保留天数的任务的会话记录，任务本身保留', async () => {
    const { project } = await addProject(t);
    const ended = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    await t.call(cancelTaskOp, { id: ended.id });
    clock.advance((STORAGE_KEEP_DAYS + 1) * DAY_MS);
    const recent = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    await t.call(cancelTaskOp, { id: recent.id });
    const draft = await createTask(t, { projectId: project.id, workflow: 'bugfix', start: false });
    for (const task of [ended, recent, draft])
      await writeAt(join(t.dataDir, 'runs', task.id, 'a.jsonl'), 1000, clock.now());

    expect((await t.call(getStorageOp, {})).body.cleanable).toContainEqual({
      target: 'transcripts',
      count: 1,
      bytes: 1000,
    });
    const { body } = await t.call(cleanStorageOp, { target: 'transcripts' });
    expect(body.freedBytes).toBe(1000);
    expect((await readdir(join(t.dataDir, 'runs'))).sort()).toEqual([draft.id, recent.id].sort());
    expect(bytesOf(body.storage, StorageKind.Transcripts)).toBe(2000);
  });
});
