import {
  clearSiteLoginOp,
  closeUserTabOp,
  listSiteLoginsOp,
  navigatePreviewTabOp,
  openLoginTabOp,
  openPreviewTabOp,
  readWebsiteOp,
  setPreviewViewportOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BrowserService } from './browser.service.ts';

export function browserOperations(browser: BrowserService) {
  return [
    implement(openPreviewTabOp, ({ taskId }) => browser.openUserTab(taskId)),
    implement(navigatePreviewTabOp, ({ tabId, path }) => browser.navigateUserTab(tabId, path)),
    implement(setPreviewViewportOp, ({ tabId, preset }) => browser.setUserViewport(tabId, preset)),
    implement(openLoginTabOp, ({ url }) => browser.openLoginTab(url)),
    implement(closeUserTabOp, ({ tabId }) => browser.closeUserTab(tabId)),
    implement(listSiteLoginsOp, () => browser.siteLogins()),
    implement(clearSiteLoginOp, ({ host }) => browser.clearSiteLogin(host)),
    implement(readWebsiteOp, ({ url }) => browser.readUrl(url)),
  ];
}
