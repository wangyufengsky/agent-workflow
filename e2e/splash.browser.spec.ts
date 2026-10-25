import { expect, test } from '@playwright/test';
import { splashHtml } from '../apps/web/src/splash/splash-page.ts';

declare global {
  interface Window {
    splash: { done: Promise<void>; leave(): Promise<void> };
  }
}

// A window that does not paint (hidden at start, a slow GPU, CI's virtual display) runs no CSS animations: the
// opening still ends and leaves on its own, or Electron main keeps the window on it (28 §5).
test('开场动画不推进时，开场页照样播完并离开', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await page.setContent(splashHtml({ theme: 'codex', intro: true }));

  await page.evaluate(() => window.splash.done);
  await expect(page.locator('html')).toHaveAttribute('data-state', 'waiting');
  await page.evaluate(() => window.splash.leave());
  await expect(page.locator('html')).toHaveAttribute('data-state', 'leaving');
});
