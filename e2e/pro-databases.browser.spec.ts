import { expect, test } from '@playwright/test';
import {
  DB_IMAGE,
  imageAvailable,
  startPostgres,
  type TestDatabase,
} from '../packages/server/test/helpers/db-containers.ts';
import { createProject, patchSettings, queueResearchTurn } from './helpers.ts';

// J21 (24 §7): a PostgreSQL connection added in the form, tested, browsed and linked to a project, then queried by a
// researcher played by FakeOpencode; the cited query runs again on the real server when the citation opens. The file
// name sorts after onboarding.browser.spec.ts, which needs the shared backend without any project.

const available = await imageAvailable(DB_IMAGE.postgres);
let server: TestDatabase;

test.beforeAll(async () => {
  test.skip(!available, `docker pull ${DB_IMAGE.postgres}`);
  test.setTimeout(180_000);
  server = await startPostgres();
  await server.exec(`
    CREATE TABLE items (id SERIAL PRIMARY KEY, name VARCHAR(64) NOT NULL, price NUMERIC(10, 2));
    COMMENT ON TABLE items IS '商品';
    COMMENT ON COLUMN items.name IS '名称';
    INSERT INTO items (name, price) VALUES ('a', 1.50), ('b', 2);
  `);
});
test.afterAll(async () => {
  if (available) await server.stop();
});

test('J21 添加 PostgreSQL 连接 → 测试连接 → 浏览表结构 → 关联项目 → AI 只读查询并引用', async ({ page, request }) => {
  test.skip(!available, `docker pull ${DB_IMAGE.postgres}`);
  await patchSettings(request, { 'ui.theme': 'github_white', 'ui.mode': 'pro' });
  const project = await createProject(request, null);

  await page.goto('/databases');
  await page.getByRole('button', { name: '添加连接' }).click();
  const dialog = page.getByRole('dialog', { name: '添加数据库连接' });
  await expect(dialog.getByLabel('端口')).toHaveValue('3306');
  await dialog.getByLabel('类型').selectOption({ label: 'PostgreSQL' });
  await expect(dialog.getByLabel('端口')).toHaveValue('5432');
  await expect(dialog).toContainText('当前 schema');
  await dialog.getByLabel('名称').fill('pg-shop');
  await dialog.getByLabel('主机').fill(server.host);
  await dialog.getByLabel('端口').fill(String(server.port));
  await dialog.getByLabel('数据库').fill(server.database);
  await dialog.getByLabel('用户名').fill(server.username);
  await dialog.getByLabel('密码').fill(server.password);
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole('article', { name: 'pg-shop' });
  await expect(card).toContainText('PostgreSQL');
  await card.getByRole('button', { name: '测试连接' }).click();
  await expect(card.getByRole('status')).toHaveText(/连接成功 · 服务器版本 PostgreSQL 17\./);
  await card.getByRole('button', { name: '浏览表结构' }).click();
  const drawer = page.getByRole('dialog', { name: 'pg-shop 的表结构' });
  await drawer.getByText('items').click();
  await expect(drawer).toContainText('商品');
  await expect(drawer).toContainText('character varying(64)');
  await expect(drawer).toContainText('名称');
  await page.keyboard.press('Escape');

  await page.goto(`/projects/${project.id}`);
  await page
    .getByRole('group', { name: '关联数据库' })
    .getByLabel(/pg-shop/)
    .check();
  await page.getByRole('button', { name: '保存' }).last().click();
  await expect(page.getByText('已更新关联的数据库')).toBeVisible();

  const sql = "SELECT name, price FROM items WHERE name = 'a'";
  await queueResearchTurn(request, project, [
    { type: 'callTool', name: 'db_list_connections', args: {} },
    { type: 'callTool', name: 'db_query', args: { connection: 'pg-shop', sql } },
    {
      type: 'callTool',
      name: 'submit_answer',
      args: { answer: '商品 a 的价格是 1.50 [1]。', citations: [{ type: 'database', connection: 'pg-shop', sql }] },
    },
  ]);
  await page.goto(`/knowledge?projectId=${project.id}`);
  await page.getByRole('button', { name: /将从 代码 · 文档 中查找依据/ }).click();
  await page.getByLabel('数据库（1）').check();
  await page.getByLabel('向项目提问').fill('商品 a 多少钱？');
  await page.getByLabel('向项目提问').press('Enter');

  const turn = page.getByTestId('knowledge-turn').first();
  await turn.getByRole('button', { name: '引用 1' }).click();
  const panel = page.getByRole('complementary', { name: '引用原文' });
  await expect(panel).toContainText(sql);
  await expect(panel.getByRole('row')).toHaveText([/name\s*price/, /a\s*1\.50/]);
});
