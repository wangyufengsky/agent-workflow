import { AppError, type BrowserPortEvent, type BrowserPortOp, ErrorCode } from '@aw/shared';

/**
 * Where browser tabs live (29 §5.2, an extension point of 03 §4.2): Electron main in the desktop app, a Chromium of
 * playwright-core in development and tests. Requests and events are those of `shared/contracts/browser-port.ts`.
 */
export type BrowserHost = {
  request(op: BrowserPortOp): Promise<unknown>;
  onEvent(listener: (event: BrowserPortEvent) => void): () => void;
};

/** The CDP events the browser module listens to; a host that cannot forward every event forwards these. */
export const BROWSER_CDP_EVENTS = [
  'Page.loadEventFired',
  'Page.frameNavigated',
  'Page.frameStartedNavigating',
  'Page.javascriptDialogOpening',
  'Runtime.exceptionThrown',
  'Runtime.consoleAPICalled',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
] as const;

/** Plain Node outside development has no browser; every use fails explicitly. */
export const unavailableBrowserHost: BrowserHost = {
  request: async () => {
    throw new AppError(ErrorCode.InternalError, 'No browser in this process');
  },
  onEvent: () => () => {},
};
