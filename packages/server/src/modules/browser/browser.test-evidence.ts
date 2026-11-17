import type { BrowserCaseStepResult } from '@aw/shared';
import type { RequestEntry } from './browser.tab.ts';

const REQUEST_LIMIT = 40;

export function browserTestPath(url: string): string {
  if (!URL.canParse(url)) return '';
  const address = new URL(url);
  return address.origin === 'null' ? '' : address.pathname;
}

export function browserTestRequests(requests: RequestEntry[]): BrowserCaseStepResult['requests'] {
  return requests.slice(-REQUEST_LIMIT).map(({ url, method, status, error, blocked }) => {
    const address = new URL(url);
    return {
      url: address.origin === 'null' ? address.protocol : address.origin + address.pathname,
      method,
      status,
      blocked,
      failed: error !== null,
    };
  });
}
