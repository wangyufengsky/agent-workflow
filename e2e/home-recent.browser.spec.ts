import { expect } from '@playwright/test';
import { test } from './assistant-fixtures.ts';
import { API_BASE, AUTH } from './env.ts';
import { box, createProject, patchSettings, queueAssistantTurn } from './helpers.ts';

// The home page's recent conversations (28 §2.1): long titles fill the row, yet「全部对话」stays one readable button
// at its end instead of being squeezed into a column of single characters over the last conversation.

const LONG = [
  '帮我看看最近 token 用量，按项目、流程、角色和模型拆开对比',
  '把最近一次知识问答做成 PPT，面向产品经理，十页以内',
  '能帮我新建一个流程吗：先方案设计，再详细设计，最后补单元测试',
];

test('最近对话：标题很长时「全部对话」仍是行尾的一行按钮，不压住对话、显示总数', async ({ page, request }) => {
  await patchSettings(request, { 'ui.theme': 'default', 'ui.mode': 'simple' });
  // The shell's pages need a project; without one they lead to onboarding.
  await createProject(request, null);
  const created: string[] = [];
  for (const text of LONG) {
    const res = await request.post(`${API_BASE}/assistant/conversations`, { headers: AUTH, data: {} });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };
    created.push(id);
    await queueAssistantTurn(request, [{ type: 'text', text: '好的。' }]);
    const sent = await request.post(`${API_BASE}/assistant/conversations/${id}/messages`, {
      headers: AUTH,
      data: { text, context: { page: 'home', params: {} } },
    });
    expect(sent.ok()).toBe(true);
  }
  try {
    const total = (
      (await (await request.get(`${API_BASE}/assistant/conversations`, { headers: AUTH })).json()) as {
        items: unknown[];
      }
    ).items.length;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const strip = page.getByRole('navigation', { name: '最近对话' });
    const all = strip.getByRole('button', { name: new RegExp(`全部对话.*${total}`) });
    await expect(all).toBeVisible();

    const button = await box(all);
    const recents = strip.getByRole('link');
    const last = await box(recents.last());
    // One line: a 30px-high button, not a column of characters.
    expect(button.bottom - button.top).toBeLessThan(40);
    // At the end of the row, clear of the last conversation.
    expect(button.left).toBeGreaterThanOrEqual(last.right);
    expect(button.right).toBeLessThanOrEqual((await box(strip)).right + 1);
    // The conversations give way: their titles are cut, their times stay whole.
    await expect(recents.last().locator('small')).toHaveText(/\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}/);

    await all.click();
    await expect(page.getByRole('menu', { name: '全部对话' }).getByRole('menuitem')).toHaveCount(total);
  } finally {
    for (const id of created) await request.delete(`${API_BASE}/assistant/conversations/${id}`, { headers: AUTH });
  }
});
