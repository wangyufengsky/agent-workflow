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

it('升级前已有的知识对话按始终询问打开，历史回答和引用仍属于原来的轮次', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE projects(id text PRIMARY KEY); INSERT INTO projects VALUES ('p');
      CREATE TABLE attempts(id text PRIMARY KEY); INSERT INTO attempts VALUES ('a1'), ('a2');`);
    db.exec(readFileSync(new URL('../../../migrations/0009_knowledge.sql', import.meta.url), 'utf8'));
    const sources = JSON.stringify({ code: true, docs: true, database: false, web: false });
    const citations = JSON.stringify([
      { type: 'file', path: 'src/main.ts', startLine: 3, endLine: 3, source: 'code', excerpt: 'start();' },
    ]);
    db.prepare('INSERT INTO knowledge_conversations VALUES (?, ?, ?, ?, ?, ?)').run('c', 'p', '入口', sources, 1, 3);
    const turn = db.prepare('INSERT INTO knowledge_turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    turn.run('t1', 'c', 1, '入口在哪？', 'a1', '见入口 [1]', citations, 1, 2);
    turn.run('t2', 'c', 2, '失败如何处理？', 'a2', null, null, 3, null);

    db.exec(readFileSync(new URL('../../../migrations/0059_knowledge_permission_mode.sql', import.meta.url), 'utf8'));

    expect(db.prepare('SELECT permission_mode, sources FROM knowledge_conversations WHERE id = ?').get('c')).toEqual({
      permission_mode: 'ask',
      sources,
    });
    expect(
      db
        .prepare('SELECT question, answer, citations FROM knowledge_turns WHERE conversation_id = ? ORDER BY seq')
        .all('c'),
    ).toEqual([
      { question: '入口在哪？', answer: '见入口 [1]', citations },
      { question: '失败如何处理？', answer: null, citations: null },
    ]);
  } finally {
    db.close();
  }
});

it('已有项目设计升级后沿用始终询问，保留每份设计的进度', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY);');
    db.exec(readFileSync(new URL('../../../migrations/0058_project_designs.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO project_designs (id,title,depth,template_key,template_snapshot,layout_style,theme,exclude_patterns,ai_review_enabled,source_snapshot,outline_confirmed_at,created_at,updated_at)
      VALUES ('d','设计','standard','general','{}','arch','default','[]',0,'{}',123,1,2)`);
    db.exec(readFileSync(new URL('../../../migrations/0063_design_permission_mode.sql', import.meta.url), 'utf8'));
    expect(
      db.prepare('SELECT permission_mode, outline_confirmed_at FROM project_designs WHERE id = ?').get('d'),
    ).toEqual({
      permission_mode: 'ask',
      outline_confirmed_at: 123,
    });
  } finally {
    db.close();
  }
});
