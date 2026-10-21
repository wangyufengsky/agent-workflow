import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';

// PDF export in the built app (23 §6.1): main prints the print view in a hidden window and saves the file. No
// opencode or model is needed: a made PPT is written into the app's database between two launches, and the save
// dialog is answered in main.

const PAGES = [
  { layout: 'cover', title: '订单服务退款改造', subtitle: '第 42 周' },
  { layout: 'bullets', title: '列表接口在大数据量下超时', bullets: ['十万条以上要 **8 秒**', '导出只能凌晨跑'] },
  { layout: 'quote', quote: '可以全量上线。' },
];

const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-pdf-'));
let app: ElectronApplication;

const launch = () => electron.launch({ args: ['apps/desktop', `--user-data-dir=${userDataDir}`] });

/** A PPT whose outline is confirmed and every page made, as the backend would have stored it (10 §4d). */
function seedDeck(): string {
  const db = new DatabaseSync(join(userDataDir, 'app.db'));
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `insert into decks (id, project_id, title, title_edited, brief, slide_count_target, theme, understanding,
      outline_confirmed_at, created_at, updated_at) values (?, null, ?, 0, ?, null, 'warm', null, ?, ?, ?)`,
  ).run(id, '订单服务退款改造', '向团队汇报', now, now, now);
  const slide = db.prepare(
    `insert into deck_slides (id, deck_id, seq, layout, title, points, content, notes, previous, updated_at)
      values (?, ?, ?, ?, ?, '[]', ?, '', null, ?)`,
  );
  for (const [i, content] of PAGES.entries()) {
    slide.run(randomUUID(), id, i + 1, content.layout, `第 ${i + 1} 页`, JSON.stringify(content), now);
  }
  db.close();
  return id;
}

test.beforeAll(async () => {
  // The first launch creates and migrates the database; the PPT is written while the app is closed.
  app = await launch();
  await expect((await app.firstWindow()).getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  await app.close();
});
test.afterAll(() => app.close());

test('导出 PDF：每页一张、文件以 %PDF 开头；PPT 不存在时返回错误而不是一直等待', async () => {
  const deckId = seedDeck();
  const saved = join(userDataDir, 'out.pdf');
  app = await launch();
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
  // The user would pick the file in the save dialog.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, saved);

  const exported = await page.evaluate((id) => window.aw?.exportPdf(id, 'deck.pdf'), deckId);
  expect(exported).toEqual({ ok: true, path: saved });
  const pdf = readFileSync(saved);
  expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(PAGES.length);

  const missing = await page.evaluate(() => window.aw?.exportPdf('no-such-deck', 'deck.pdf'));
  expect(missing).toMatchObject({ ok: false, error: { code: 'DECK_NOT_FOUND' } });
});
