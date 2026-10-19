import { THEME_IDS } from '@aw/shared';
import { expect, test } from '@playwright/test';
import { patchSettings } from './helpers.ts';

// Screenshots for manual review of the shared components in every theme (M1-12); no pixel assertions (07 §3.2).
for (const theme of THEME_IDS) {
  test(`组件走查截图：${theme}`, async ({ page, request }, testInfo) => {
    await patchSettings(request, { 'ui.theme': theme });
    await page.goto('/dev/components');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({
      path: testInfo.outputPath(`components-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });

    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`dialog-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Open palette' }).click();
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`palette-${theme}.png`), animations: 'disabled' });
  });
}
