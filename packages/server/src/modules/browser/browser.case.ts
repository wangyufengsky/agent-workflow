import {
  AppError,
  type BrowserCase,
  type BrowserCaseChallenge,
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

async function performAction(browser: BrowserService, owner: BrowserOwner, step: BrowserCaseStep, signal: AbortSignal) {
  const { action } = step;
  if (action.kind !== 'check') {
    const ref = await browser.resolveCaseRef(owner, action.selector);
    signal.throwIfAborted();
    if (action.kind === 'click') await browser.click(owner, ref);
    else if (action.kind === 'fill') await browser.type(owner, ref, { text: action.value, clear: true, submit: false });
    else await browser.select(owner, ref, [action.value]);
  }
}

/** 执行用户保存的步骤。发生失败后停止，同一个请求不会被执行器主动重试。 */
export async function runBrowserCase(
  browser: BrowserService,
  owner: BrowserOwner,
  test: BrowserCase,
  signal: AbortSignal,
  waitForUser: (step: number, reason: BrowserCaseChallenge) => Promise<void>,
): Promise<BrowserCaseReport> {
  const steps: BrowserCaseStepResult[] = [];
  let outcome: BrowserCaseOutcome = BrowserCaseOutcome.Passed;
  let acceptedChallenge: string | null = null;
  try {
    for (const [step, definition] of [null, ...test.steps].entries()) {
      signal.throwIfAborted();
      browser.beginCaseStep(owner);
      let actual: BrowserCaseStepResult['actual'] = null;
      let errorCode: ErrorCode | null = null;
      const beforeHandoff: RequestEntry[] = [];
      let handedOff = false;
      const handoffIfNeeded = async (): Promise<boolean> => {
        signal.throwIfAborted();
        const challenge = await browser.caseChallenge(owner);
        if (challenge === null) {
          acceptedChallenge = null;
          return false;
        }
        if (!challenge.persistent && challenge.key === acceptedChallenge) return false;
        beforeHandoff.push(...browser.caseRequests(owner));
        await waitForUser(step, challenge.reason);
        signal.throwIfAborted();
        handedOff = true;
        const remaining = await browser.caseChallenge(owner);
        acceptedChallenge = remaining?.persistent === false ? remaining.key : null;
        browser.beginCaseStep(owner);
        return true;
      };
      try {
        if (definition === null) {
          await browser.open(owner, test.scope.target, signal);
          await handoffIfNeeded();
        } else {
          await handoffIfNeeded();
          signal.throwIfAborted();
          try {
            await performAction(browser, owner, definition, signal);
          } catch (err) {
            if (!(await handoffIfNeeded())) throw err;
          }
          let result: Awaited<ReturnType<BrowserService['evaluateCaseAssertion']>>;
          for (;;) {
            await handoffIfNeeded();
            try {
              result = await browser.evaluateCaseAssertion(owner, definition.expect);
            } catch (err) {
              if (await handoffIfNeeded()) continue;
              throw err;
            }
            if (!(await handoffIfNeeded())) break;
          }
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
      const requests = [...beforeHandoff, ...browser.caseRequests(owner)];
      if (requests.some((r) => r.blocked !== null && (!READ_METHODS.has(r.method) || r.resourceType === 'Document')))
        outcome = BrowserCaseOutcome.Blocked;
      else if (
        step === 0 &&
        !handedOff &&
        requests.some((r) => r.resourceType === 'Document' && (r.error !== null || (r.status ?? 0) >= 400))
      )
        outcome = BrowserCaseOutcome.Failed;
      const screenshot = outcome === BrowserCaseOutcome.Passed ? null : await browser.caseFailureScreenshot(owner);
      signal.throwIfAborted();
      steps.push({
        step,
        outcome,
        actual,
        errorCode,
        screenshot,
        requests: requestEvidence(requests),
      });
      if (outcome !== BrowserCaseOutcome.Passed) break;
    }
    return { outcome, steps, attemptId: owner.id };
  } finally {
    await browser.close(owner.id);
  }
}
