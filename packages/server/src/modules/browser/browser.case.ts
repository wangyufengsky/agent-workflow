import {
  AppError,
  type BrowserCase,
  BrowserCaseOutcome,
  type BrowserCaseReport,
  type BrowserCaseStep,
  type BrowserCaseStepResult,
  ErrorCode,
} from '@aw/shared';
import type { BrowserOwner, BrowserService } from './browser.service.ts';
import type { RequestEntry } from './browser.tab.ts';

const REQUEST_LIMIT = 40;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestEvidence(requests: RequestEntry[]): BrowserCaseStepResult['requests'] {
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

async function perform(browser: BrowserService, owner: BrowserOwner, step: BrowserCaseStep, signal: AbortSignal) {
  const { action, expect } = step;
  if (action.kind !== 'check') {
    const ref = await browser.resolveCaseRef(owner, action.selector);
    signal.throwIfAborted();
    if (action.kind === 'click') await browser.click(owner, ref);
    else if (action.kind === 'fill') await browser.type(owner, ref, { text: action.value, clear: true, submit: false });
    else await browser.select(owner, ref, [action.value]);
  }
  signal.throwIfAborted();
  return browser.evaluateCaseAssertion(owner, expect);
}

/** 执行用户保存的步骤。发生失败后停止，同一个请求不会被执行器主动重试。 */
export async function runBrowserCase(
  browser: BrowserService,
  owner: BrowserOwner,
  test: BrowserCase,
  signal: AbortSignal,
): Promise<BrowserCaseReport> {
  const steps: BrowserCaseStepResult[] = [];
  let outcome: BrowserCaseOutcome = BrowserCaseOutcome.Passed;
  try {
    for (const [step, definition] of [null, ...test.steps].entries()) {
      signal.throwIfAborted();
      browser.beginCaseStep(owner);
      let actual: BrowserCaseStepResult['actual'] = null;
      let errorCode: ErrorCode | null = null;
      try {
        if (definition === null) {
          await browser.open(owner, test.scope.target, signal);
        } else {
          const result = await perform(browser, owner, definition, signal);
          actual = result.actual;
          if (!result.pass) outcome = BrowserCaseOutcome.Failed;
        }
      } catch (err) {
        signal.throwIfAborted();
        errorCode = err instanceof AppError ? err.code : ErrorCode.BrowserActionFailed;
        outcome = [
          ErrorCode.BrowserLoginRequired,
          ErrorCode.BrowserSiteNotAllowed,
          ErrorCode.PreviewNotConfigured,
        ].some((code) => code === errorCode)
          ? BrowserCaseOutcome.Blocked
          : BrowserCaseOutcome.Failed;
      }
      signal.throwIfAborted();
      const requests = browser.caseRequests(owner);
      if (requests.some((r) => r.blocked !== null && (!READ_METHODS.has(r.method) || r.resourceType === 'Document')))
        outcome = BrowserCaseOutcome.Blocked;
      else if (
        step === 0 &&
        requests.some((r) => r.resourceType === 'Document' && (r.error !== null || (r.status ?? 0) >= 400))
      )
        outcome = BrowserCaseOutcome.Failed;
      const screenshot = outcome === BrowserCaseOutcome.Passed ? null : await browser.caseFailureScreenshot(owner);
      signal.throwIfAborted();
      steps.push({ step, outcome, actual, errorCode, screenshot, requests: requestEvidence(requests) });
      if (outcome !== BrowserCaseOutcome.Passed) break;
    }
    return { outcome, steps, attemptId: owner.id };
  } finally {
    await browser.close(owner.id);
  }
}
