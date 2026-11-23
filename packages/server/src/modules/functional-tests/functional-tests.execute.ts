import { isDeepStrictEqual } from 'node:util';
import {
  AppError,
  type FunctionalTestCase,
  type FunctionalTestEvent,
  FunctionalTestStatus,
  type FunctionalTestStep,
} from '@aw/shared';
import type { BrowserOwner, BrowserService } from '../browser/index.ts';
import { createFunctionalBrowser } from './functional-tests.browser.ts';
import { createHttpRunner, fieldValue, redact, redactText } from './functional-tests.http.ts';

type Emit = (
  step: number | null,
  kind: FunctionalTestEvent['kind'],
  message: string,
  detail: FunctionalTestEvent['detail'],
) => void;
type Options = {
  definition: FunctionalTestCase;
  browser: BrowserService;
  owner: BrowserOwner;
  target: string;
  writes: Parameters<typeof createHttpRunner>[1]['writes'];
  signal: AbortSignal;
  emit: Emit;
  time: () => number;
  logTail: () => string;
  waitForUser: (wait: () => Promise<void>) => Promise<void>;
};

export async function executeCase({
  definition,
  browser,
  owner,
  target,
  writes,
  signal,
  emit,
  time,
  logTail,
  waitForUser,
}: Options) {
  const origin = new URL(target).origin;
  const http = createHttpRunner(origin, { origin, writes }, signal);
  const website = createFunctionalBrowser(browser, owner, signal, async (step, reason, wait) => {
    await waitForUser(() => {
      const pending = wait();
      emit(step, 'handoff', '浏览器需要人工接管', { reason });
      return pending;
    });
    emit(step, 'handoff', '已恢复页面操作', { reason });
  });
  async function runStep(step: FunctionalTestStep, index: number): Promise<FunctionalTestStatus> {
    signal.throwIfAborted();
    mayWrite = step.kind === 'browser' ? writes.length > 0 : !['GET', 'HEAD', 'OPTIONS'].includes(step.method);
    if (step.kind === 'http') {
      const started = time();
      const result = await http(step, index, (path) =>
        emit(index, 'action', '等待 HTTP 响应', {
          title: redactText(step.title),
          method: step.method,
          path: redactText(path),
        }),
      );
      let outcome: FunctionalTestStatus = FunctionalTestStatus.Passed;
      const values = {};
      for (const assertion of step.assertions) {
        const observed = fieldValue(result, assertion.field);
        const passed = observed === undefined ? null : isDeepStrictEqual(observed, assertion.equals);
        const checked =
          passed === null
            ? FunctionalTestStatus.Blocked
            : passed
              ? FunctionalTestStatus.Passed
              : FunctionalTestStatus.Failed;
        if (checked === FunctionalTestStatus.Failed || outcome === FunctionalTestStatus.Passed) outcome = checked;
        const safe = redact({ [assertion.field]: observed ?? null });
        emit(index, 'assertion', 'HTTP 断言', {
          field: assertion.field,
          expected: redact({ [assertion.field]: assertion.equals }),
          actual: safe,
          passed,
          basis: redactText(assertion.basis),
        });
        Object.assign(values, { [assertion.field]: safe });
      }
      emit(index, 'result', '收到 HTTP 响应', { status: result.status, elapsedMs: time() - started, fields: values });
      return outcome;
    }
    emit(index, 'action', '执行浏览器操作', { title: redactText(step.title), action: redact(step.action) });
    const started = time();
    const result = await website(step, index);
    emit(index, 'result', '浏览器实测结果', {
      status: result.pass ? FunctionalTestStatus.Passed : FunctionalTestStatus.Failed,
      elapsedMs: time() - started,
      requests: result.requests,
      logs: result.logs,
      screenshot: result.screenshot,
      attemptId: owner.id,
    });
    if (result.requests.some(({ blocked, method }) => blocked !== null && !['GET', 'HEAD', 'OPTIONS'].includes(method)))
      return FunctionalTestStatus.Blocked;
    emit(index, 'assertion', '页面断言', {
      field: step.expect.kind,
      expected: redact(step.expect),
      actual: redact(result.actual),
      passed: result.pass,
      basis: redactText(step.basis),
    });
    return result.pass ? FunctionalTestStatus.Passed : FunctionalTestStatus.Failed;
  }
  let outcome: FunctionalTestStatus = FunctionalTestStatus.Passed;
  let stepIndex: number | null = null;
  let mayWrite = false;
  try {
    for (const [index, step] of definition.steps.entries()) {
      stepIndex = index;
      outcome = await runStep(step, index);
      if (outcome !== FunctionalTestStatus.Passed) break;
    }
    for (const [offset, step] of definition.cleanup.entries()) {
      stepIndex = definition.steps.length + offset;
      const cleaned = await runStep(step, stepIndex);
      emit(stepIndex, 'cleanup', '测试数据清理', { status: cleaned });
      if (outcome === FunctionalTestStatus.Passed && cleaned !== FunctionalTestStatus.Passed)
        outcome = FunctionalTestStatus.Blocked;
    }
  } catch (error) {
    if (!(error instanceof AppError || error instanceof TypeError || error instanceof DOMException)) throw error;
    const reason = signal.aborted
      ? '运行已中断，已发送的写入可能已经提交，需先核实实际状态'
      : redactText(error.message);
    emit(stepIndex, 'result', reason, {
      status: FunctionalTestStatus.Blocked,
      ...(mayWrite && (!(error instanceof AppError) || signal.aborted) ? { unknownWrite: true } : {}),
    });
    outcome = FunctionalTestStatus.Blocked;
  } finally {
    await browser.close(owner.id);
    const output = redactText(logTail());
    if (output.length > 0) emit(null, 'environment', '测试期间的服务日志尾部', { logTail: output });
  }
  return outcome;
}
