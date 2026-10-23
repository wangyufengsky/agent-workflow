import { clearSiteLoginOp, closeUserTabOp, listSiteLoginsOp, openLoginTabOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { BrowserService } from './browser.service.ts';

export function browserOperations(browser: BrowserService) {
  return [
    implement(openLoginTabOp, ({ url }) => browser.openLoginTab(url)),
    implement(closeUserTabOp, ({ tabId }) => browser.closeUserTab(tabId)),
    implement(listSiteLoginsOp, () => browser.siteLogins()),
    implement(clearSiteLoginOp, ({ host }) => browser.clearSiteLogin(host)),
  ];
}
