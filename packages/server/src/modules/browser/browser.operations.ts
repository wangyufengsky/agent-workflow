import {
  clearSiteLoginOp,
  closeUserTabOp,
  listBrowserFramesOp,
  listSiteLoginsOp,
  navigateUserTabOp,
  openLoginTabOp,
  openUserTabOp,
  setUserViewportOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BrowserService } from './browser.service.ts';

export function browserOperations(browser: BrowserService) {
  return [
    implement(openLoginTabOp, ({ url }) => browser.openLoginTab(url)),
    implement(closeUserTabOp, ({ tabId }) => browser.closeUserTab(tabId)),
    implement(listSiteLoginsOp, () => browser.siteLogins()),
    implement(clearSiteLoginOp, ({ host }) => browser.clearSiteLogin(host)),
    implement(openUserTabOp, ({ taskId }) => browser.openUserTab(taskId)),
    implement(navigateUserTabOp, ({ tabId, path }) => browser.navigateUserTab(tabId, path)),
    implement(setUserViewportOp, ({ tabId, preset }) => browser.setUserViewport(tabId, preset)),
    implement(listBrowserFramesOp, ({ attemptId }) => ({ items: browser.frames(attemptId) })),
  ];
}
