import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initiativeCoverageItemSnapshotSchema } from '@aw/shared';
import { expect, it } from 'vitest';

it('升级旧需求计划时保存当前任务与最后一份覆盖，不凭空生成更早历史', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE initiatives (id TEXT PRIMARY KEY, breakdown_rev INTEGER NOT NULL, coverage TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
      CREATE TABLE initiative_items (id TEXT PRIMARY KEY, initiative_id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, task_id TEXT, updated_at INTEGER NOT NULL);
      INSERT INTO initiatives VALUES ('i', 3, '[{"point":"需求","items":["a"]}]', 42);
      INSERT INTO tasks VALUES ('t');
      INSERT INTO initiative_items VALUES ('p', 'i', 'a', '工作包', 't', 40);
    `);
    db.exec(readFileSync(new URL('../../../migrations/0039_spotty_gressill.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT item_id, task_id, created_at FROM initiative_item_tasks').all()).toEqual([
      { item_id: 'p', task_id: 't', created_at: 40 },
    ]);
    const version = db.prepare('SELECT revision, coverage, items FROM initiative_coverage_versions').get();
    expect(version?.revision).toBe(3);
    expect(JSON.parse(String(version?.coverage))).toEqual([{ point: '需求', items: ['a'] }]);
    const items = JSON.parse(String(version?.items));
    expect(items).toEqual([{ id: 'p', key: 'a', title: '工作包' }]);
    expect(initiativeCoverageItemSnapshotSchema.parse(items[0])).toEqual({ id: 'p', key: 'a', title: '工作包' });
  } finally {
    db.close();
  }
});
