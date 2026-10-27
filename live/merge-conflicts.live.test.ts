import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deliverTaskOp,
  getProjectOp,
  getTaskOp,
  requestChangesOp,
  ServerEventType,
  TaskStatus,
  type TranscriptEntry,
} from '@aw/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SkillName } from '../packages/builtin/src/skills.ts';
import { runGit } from '../packages/server/src/modules/git/index.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { type LiveApp, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * SK-04 (41 §5.2): a real conflict step. A task changes `average`; meanwhile main rewrites the same lines; delivering
 * conflicts and the AI resolves it with the skill `revise-conflict.md` names, keeping both changes.
 */
const IDENTITY = ['-c', 'user.name=aw-live', '-c', 'user.email=aw-live@example.com'];
const MAIN_AVERAGE = `/** Arithmetic mean of the values, summed with reduce. */
export function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
`;

let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('merge-conflicts');
}, 120_000);
afterAll(() => live.close());

it(
  '@live 交给 AI 解决冲突：加载 aw-merge-conflicts，两边的改动都保留，之后能合并',
  async () => {
    const { t } = live;
    const task = await live.runTask(
      'bugfix',
      'ts-stats',
      'src/stats.ts 的 average 在空数组时返回 NaN。改为空数组时抛出 RangeError（消息为 "values must not be empty"），并补上测试。',
    );
    expect(task.status).toBe(TaskStatus.Review);
    const { body: project } = await t.call(getProjectOp, { id: task.project.id });

    // Main rewrites the same lines meanwhile.
    const file = join(project.repoPath, 'src', 'stats.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace(/\/\*\* Arithmetic mean[\s\S]*?\n}\n/, MAIN_AVERAGE));
    await runGit([...IDENTITY, 'commit', '-q', '-am', 'refactor: average with reduce'], { cwd: project.repoPath });

    const { body: conflicted } = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect(conflicted.lastDelivery).toMatchObject({ status: 'conflict' });
    expect(conflicted.lastDelivery?.conflictFiles).toContain('src/stats.ts');

    const ended = waitForEvent(
      t.app.events,
      ServerEventType.TaskUpdated,
      (d) => d.id === task.id && (d.status === TaskStatus.Review || d.status === TaskStatus.Failed),
      TASK_TIMEOUT_MS,
    );
    expect((await t.call(requestChangesOp, { id: task.id, reason: 'conflict' })).status).toBe(200);
    await ended;
    const { body: resolved } = await t.call(getTaskOp, { id: task.id });
    expect(resolved.status).toBe(TaskStatus.Review);

    const node = resolved.nodes.find((n) => n.key === 'resolve_conflict_1');
    const runs = join(t.dataDir, 'runs', task.id);
    const skills: unknown[] = [];
    for (const name of (await readdir(runs)).filter((f) => f.endsWith('.jsonl'))) {
      const entries: TranscriptEntry[] = (await readFile(join(runs, name), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      for (const e of entries) if (e.kind === 'tool_call' && e.data.tool === 'skill') skills.push(e.data.input.name);
    }
    expect(node).toBeDefined();
    expect(skills).toContain(SkillName.MergeConflicts);

    const worktree = resolved.git.worktreePath ?? '';
    const merged = await readFile(join(worktree, 'src', 'stats.ts'), 'utf8');
    expect(merged).not.toMatch(/^(<{7}|={7}|>{7})/m);
    expect(merged).toContain('reduce');
    expect(merged).toContain('values must not be empty');

    const { body: done } = await t.call(deliverTaskOp, { id: task.id, strategy: 'squash' });
    expect(done.lastDelivery).toMatchObject({ status: 'succeeded' });
  },
  3 * TASK_TIMEOUT_MS,
);
