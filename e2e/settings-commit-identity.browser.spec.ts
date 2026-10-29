import { expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, patchSettings } from './helpers.ts';

const savedIdentity = async (request: Parameters<typeof patchSettings>[0]) =>
  (await (await request.get(`${API_BASE}/settings`, { headers: AUTH })).json())['git.commitIdentity'];

test('任务的提交人：名字与邮箱都填了才保存，只填一项时标出，清空恢复默认（D227）', async ({ page, request }) => {
  await createProject(request, null);
  await patchSettings(request, { 'ui.mode': 'pro', 'git.commitIdentity': null });
  await page.goto('/settings');
  const group = page.getByRole('group', { name: '任务的提交人' });
  const name = group.getByRole('textbox', { name: '名字' });
  const email = group.getByRole('textbox', { name: '邮箱' });

  // Moving from one input to the other is not leaving the setting: nothing is checked or saved yet.
  await name.fill('Zhang San');
  await email.focus();
  await expect(group.getByText('要么都留空')).toBeHidden();
  await page.getByRole('heading', { name: '专业设置' }).click();
  await expect(group.getByText('要么都留空')).toBeVisible();
  expect(await savedIdentity(request)).toBeNull();

  await email.fill('zs@corp');
  await email.press('Enter');
  await expect(group.getByText('要么都留空')).toBeHidden();
  await expect.poll(() => savedIdentity(request)).toEqual({ name: 'Zhang San', email: 'zs@corp' });

  // Saving re-keys the inputs once the response is in; a fresh page has nothing pending and shows what was saved.
  await page.reload();
  await expect(name).toHaveValue('Zhang San');
  await expect(email).toHaveValue('zs@corp');
  await name.fill('');
  await email.fill('');
  await email.press('Enter');
  await expect.poll(() => savedIdentity(request)).toBeNull();
});
