import { type DeckMaterialKind, DeckStatus, deckSchema, McpToolName, type ThemeId } from '@aw/shared';
import { type APIRequestContext, expect, type Page, type TestInfo } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { type E2EProject, queueWriterTurn } from './helpers.ts';

export async function createPptFromSource(
  page: Page,
  request: APIRequestContext,
  info: TestInfo,
  project: E2EProject,
  source: {
    kind: typeof DeckMaterialKind.Design | typeof DeckMaterialKind.GitReview;
    refId: string;
    title: string;
    theme: ThemeId;
    brief: RegExp;
  },
) {
  await page.getByRole('link', { name: '生成 PPT', exact: true }).click();
  await expect(page).toHaveURL(/\/decks\/new\?/);
  const sourceParams = new URL(page.url()).searchParams;
  expect(sourceParams.get('kind')).toBe(source.kind);
  expect(sourceParams.get('refId')).toBe(source.refId);
  await expect(page.getByRole('heading', { name: '做一份 PPT' })).toBeVisible();
  await expect(page.getByLabel('项目代码')).toHaveValue(project.id);
  await expect(page.getByRole('list', { name: '资料' })).toContainText(source.title);
  const brief = page.getByLabel('这份 PPT 讲什么');
  await expect(brief).toHaveValue(source.brief);
  const requestedBrief = `${await brief.inputValue()} 重点注明上线前需要复核的内容。`;
  await brief.fill(requestedBrief);
  await expect(page.locator('html')).toHaveAttribute('data-theme', source.theme);
  await page.screenshot({
    path: info.outputPath(`ppt-${source.kind}-prefill-${source.theme}.png`),
    animations: 'disabled',
  });

  const title = '项目交付复核汇报';
  await queueWriterTurn(request, project, [
    {
      type: 'callTool',
      name: McpToolName.SubmitOutline,
      args: {
        title,
        understanding: { audience: '项目团队', duration: '约 5 分钟', assumptions: [] },
        slides: [
          { layout: 'cover', title, points: ['汇报范围'] },
          { layout: 'bullets', title: '上线前复核', points: ['根据来源资料复核'] },
        ],
      },
    },
  ]);
  await page.getByRole('button', { name: /^生成大纲/ }).click();
  await expect(page).toHaveURL(/\/ppt\/[0-9a-f-]+$/);
  await expect(page.getByRole('main').getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByTestId('outline-page')).toHaveCount(2);
  const deckId = new URL(page.url()).pathname.split('/').at(-1);
  const stored = await request.get(`${API_BASE}/decks/${deckId}`, { headers: AUTH });
  await expect(stored).toBeOK();
  const deck = deckSchema.parse(await stored.json());
  expect(deck).toMatchObject({
    status: DeckStatus.OutlineReady,
    brief: requestedBrief,
    project: { id: project.id },
    materials: [{ kind: source.kind, refId: source.refId, title: source.title }],
  });
  expect(deck.materials[0]?.chars).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', source.theme);
  await page.screenshot({
    path: info.outputPath(`ppt-${source.kind}-outline-${source.theme}.png`),
    animations: 'disabled',
  });
}
