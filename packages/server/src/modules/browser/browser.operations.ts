import {
  captureBrowserTestOp,
  clearSiteLoginOp,
  closeUserTabOp,
  listBrowserFramesOp,
  listBrowserTestActionsOp,
  listSiteLoginsOp,
  navigateUserTabOp,
  openLoginTabOp,
  openUserTabOp,
  pickFrontendElementOp,
  readWebsiteOp,
  resumeBrowserCaseOp,
  setUserViewportOp,
  takeBrowserCaseHandoffOp,
  userTabLogsOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BrowserService } from './browser.service.ts';

export function browserOperations(browser: BrowserService) {
  return [
    implement(takeBrowserCaseHandoffOp, ({ id, handoffId }) => browser.caseHandoffs.take(id, handoffId)),
    implement(resumeBrowserCaseOp, ({ id, handoffId }) => browser.caseHandoffs.resume(id, handoffId)),
    implement(openLoginTabOp, ({ url }) => browser.openLoginTab(url)),
    implement(closeUserTabOp, ({ tabId }) => browser.closeUserTab(tabId)),
    implement(listSiteLoginsOp, () => browser.siteLogins()),
    implement(clearSiteLoginOp, ({ host }) => browser.clearSiteLogin(host)),
    implement(openUserTabOp, ({ taskId }) => browser.openUserTab(taskId)),
    implement(pickFrontendElementOp, async ({ tabId, requestId, cancel }) => ({
      element: await browser.pickFrontendElement(tabId, requestId, cancel ?? false),
    })),
    implement(navigateUserTabOp, ({ tabId, path }) => browser.navigateUserTab(tabId, path)),
    implement(setUserViewportOp, ({ tabId, preset }) => browser.setUserViewport(tabId, preset)),
    implement(userTabLogsOp, ({ tabId }) => browser.userTabLogs(tabId)),
    implement(listBrowserFramesOp, ({ attemptId }) => ({ items: browser.frames(attemptId) })),
    implement(listBrowserTestActionsOp, ({ attemptId }) => ({ items: browser.testActions(attemptId) })),
    implement(captureBrowserTestOp, ({ taskId, attemptId }) => browser.captureTest(taskId, attemptId)),
    implement(readWebsiteOp, ({ url }) => browser.readUrl(url)),
  ];
}
