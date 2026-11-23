import { AppError, ErrorCode, type FunctionalTestStep } from '@aw/shared';
import { type BrowserOwner, type BrowserService, browserTestRequests } from '../browser/index.ts';
import { redactText } from './functional-tests.http.ts';

export function createFunctionalBrowser(
  browser: BrowserService,
  owner: BrowserOwner,
  signal: AbortSignal,
  handoff: (step: number, reason: string, wait: () => Promise<void>) => Promise<void>,
) {
  const target = owner.browserTest?.target;
  if (target === undefined) throw new Error('Functional browser requires a scope');
  let opened = false;
  let allowedChallenge: string | null = null;
  let address = target;
  async function waitForUser(step: number): Promise<void> {
    signal.throwIfAborted();
    const challenge = await browser.caseChallenge(owner);
    if (challenge === null) {
      allowedChallenge = null;
      return;
    }
    if (!challenge.persistent && challenge.key === allowedChallenge) return;
    await handoff(step, challenge.reason, () => browser.caseHandoffs.wait(owner, step, challenge.reason, signal));
    allowedChallenge = challenge.persistent ? null : challenge.key;
  }
  return async (definition: Extract<FunctionalTestStep, { kind: 'browser' }>, step: number) => {
    const { action } = definition;
    if (!opened) {
      const initial = await browser.open(owner, target, signal);
      opened = true;
      address = initial.url;
      if (initial.blockedWrites.length > 0)
        throw new AppError(ErrorCode.BrowserSiteNotAllowed, 'The browser navigation was blocked by the test scope');
      await waitForUser(step);
    }
    browser.beginCaseStep(owner);
    if (action.kind === 'open' || action.kind === 'reload') {
      const url = action.kind === 'reload' ? address : new URL(action.path, target).href;
      address = (await browser.open(owner, url, signal)).url;
    } else if (action.kind !== 'check') {
      const ref = await browser.resolveCaseRef(owner, action.selector);
      signal.throwIfAborted();
      if (action.kind === 'click') address = (await browser.click(owner, ref)).url;
      else if (action.kind === 'fill')
        await browser.type(owner, ref, { text: action.value, clear: true, submit: false });
      else await browser.select(owner, ref, [action.value]);
    }
    await waitForUser(step);
    const check = await browser.evaluateCaseAssertion(owner, definition.expect);
    const requests = browserTestRequests(browser.caseRequests(owner));
    const logs = browser
      .logs(owner, 'last')
      .console.slice(-20)
      .map(({ text }) => redactText(text));
    const screenshot = check.pass ? null : (await browser.screenshot(owner, { fullPage: false })).file;
    return { ...check, requests, logs, screenshot };
  };
}
