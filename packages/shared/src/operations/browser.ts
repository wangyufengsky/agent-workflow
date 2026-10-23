import { z } from 'zod';
import { openLoginTabRequestSchema, siteLoginsSchema, userTabSchema } from '../contracts/api/browser.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

// Website logins are the user's own, done in the settings page (29 §8.6); the assistant has no part in them.
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

export const openLoginTabOp = defineOperationContract({
  ...common,
  id: 'browser.openLoginTab',
  title: 'op.browser.openLoginTab',
  description: 'Open a website in a tab of the window for the user to log in; the AI browses with that login',
  input: openLoginTabRequestSchema,
  output: userTabSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/browser/login-tabs', status: 201 },
});

export const closeUserTabOp = defineOperationContract({
  ...common,
  id: 'browser.closeUserTab',
  title: 'op.browser.closeUserTab',
  description: "Close one of the user's browser tabs",
  input: userTabSchema,
  output: z.void(),
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/browser/tabs/:tabId' },
});

export const listSiteLoginsOp = defineOperationContract({
  ...common,
  id: 'browser.listSiteLogins',
  title: 'op.browser.listSiteLogins',
  description: 'Websites the user is logged in to for the AI (hosts with cookies in the login partition)',
  input: z.object({}),
  output: siteLoginsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/browser/site-logins' },
});

export const clearSiteLoginOp = defineOperationContract({
  ...common,
  id: 'browser.clearSiteLogin',
  title: 'op.browser.clearSiteLogin',
  description: 'Log out of a website: delete its cookies and storage in the login partition',
  input: z.object({ host: z.string().min(1) }),
  output: siteLoginsSchema,
  risk: OperationRisk.Write,
  http: { method: 'DELETE', path: '/browser/site-logins/:host' },
});
