import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it.each([null, 'provider/role'])('旧任务和对话沿用始终询问，保留既有角色选择 %s', (model) => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE assistant_conversations(id text); INSERT INTO assistant_conversations VALUES('c');
      CREATE TABLE tasks(id text); INSERT INTO tasks VALUES('t');
      CREATE TABLE attempts(id text);
      CREATE TABLE roles(key text,model text);
      CREATE TABLE settings(key text,value text); INSERT INTO settings VALUES('ai.imageModel','"provider/vision"');`);
    db.prepare('INSERT INTO roles VALUES(?,?)').run('image_processor', model);
    db.exec(readFileSync(new URL('../../../migrations/0053_scoped_permissions.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT model FROM roles').get()?.model).toBe(model ?? 'provider/vision');
    expect(db.prepare('SELECT value FROM settings').all()).toEqual([]);
    expect(
      db
        .prepare('SELECT permission_mode FROM tasks UNION ALL SELECT permission_mode FROM assistant_conversations')
        .all(),
    ).toEqual([{ permission_mode: 'ask' }, { permission_mode: 'ask' }]);
  } finally {
    db.close();
  }
});
