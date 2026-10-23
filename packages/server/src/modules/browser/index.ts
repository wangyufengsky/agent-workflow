import { browserOperations } from './browser.operations.ts';
import { type BrowserServiceDeps, createBrowserService } from './browser.service.ts';

export { BROWSER_CDP_EVENTS, type BrowserHost, unavailableBrowserHost } from './browser.host.ts';
export type { BrowserOwner, BrowserService } from './browser.service.ts';
export { type BrowserTransport, createPortBrowserHost, parentPortBrowserTransport } from './host.port.ts';

export function createBrowserModule(deps: BrowserServiceDeps) {
  const service = createBrowserService(deps);
  return { service, operations: browserOperations(service) };
}
