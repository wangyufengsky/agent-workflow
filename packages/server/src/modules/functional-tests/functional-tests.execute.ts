import { isDeepStrictEqual } from 'node:util';
import {
  AppError,
  ErrorCode,
  type FunctionalTestCase,
  type FunctionalTestEvent,
  FunctionalTestStatus,
  type FunctionalTestStep,
} from '@aw/shared';
import type { BrowserOwner, BrowserService } from '../browser/index.ts';
import { createFunctionalBrowser } from './functional-tests.browser.ts';
import { createHttpRunner, fieldValue, redact, redactField, redactText } from './functional-tests.http.ts';

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
  let mayWrite = false;
  let confirmedWrite = false;
  async function runStep(step: FunctionalTestStep, index: number): Promise<FunctionalTestStatus> {
    mayWrite = false;
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
      if (mayWrite && result.status >= 200 && result.status < 300) confirmedWrite = true;
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
        const safe = redactField(assertion.field, observed ?? null);
        emit(index, 'assertion', 'HTTP 断言', {
          field: assertion.field,
          expected: redactField(assertion.field, assertion.equals),
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
    if (
      result.requests.some(
        ({ method, status, blocked }) =>
          blocked === null &&
          status !== null &&
          status >= 200 &&
          status < 300 &&
          !['GET', 'HEAD', 'OPTIONS'].includes(method),
      )
    )
      confirmedWrite = true;
    const blocked = result.requests.some(
      ({ blocked, method }) => blocked !== null && !['GET', 'HEAD', 'OPTIONS'].includes(method),
    );
    emit(index, 'result', '浏览器实测结果', {
      status: blocked
        ? FunctionalTestStatus.Blocked
        : result.pass
          ? FunctionalTestStatus.Passed
          : FunctionalTestStatus.Failed,
      elapsedMs: time() - started,
      requests: result.requests,
      logs: result.logs,
      screenshot: result.screenshot,
      attemptId: owner.id,
    });
    if (blocked) return FunctionalTestStatus.Blocked;
    emit(index, 'assertion', '页面断言', {
      field: step.expect.kind,
      expected: redact(step.expect),
      actual: redact(result.actual),
      passed: result.pass,
      basis: redactText(step.basis),
    });
    return result.pass ? FunctionalTestStatus.Passed : FunctionalTestStatus.Failed;
  }
  function recordInterruption(index: number, error: unknown): boolean {
    if (!(error instanceof AppError || error instanceof TypeError || error instanceof DOMException)) throw error;
    const unknownWrite =
      mayWrite &&
      (!(error instanceof AppError) ||
        signal.aborted ||
        error.details?.unknownWrite === true ||
        error.code === ErrorCode.BrowserActionFailed);
    const reason = signal.aborted
      ? unknownWrite
        ? '运行已中断，需先核实已发送的写入'
        : '运行已中断'
      : redactText(error.message);
    emit(index, 'result', reason, {
      status: FunctionalTestStatus.Blocked,
      ...(unknownWrite ? { unknownWrite: true } : {}),
    });
    return unknownWrite;
  }

  let outcome: FunctionalTestStatus = FunctionalTestStatus.Passed;
  try {
    for (const [index, step] of definition.steps.entries()) {
      try {
        outcome = await runStep(step, index);
      } catch (error) {
        const unknownWrite = recordInterruption(index, error);
        outcome = FunctionalTestStatus.Blocked;
        // 已确认的写入仍可按用例清理。未知写入和取消需要先核实，不再发送请求。
        if (signal.aborted || unknownWrite || !confirmedWrite) {
          if (definition.cleanup.length > 0)
            emit(
              index,
              'cleanup',
              unknownWrite || signal.aborted ? '运行中止，需核实数据状态后清理' : '无已确认的写入，未执行清理',
              { status: FunctionalTestStatus.NotRun },
            );
          return outcome;
        }
      }
      if (outcome !== FunctionalTestStatus.Passed) break;
    }
    for (const [offset, step] of definition.cleanup.entries()) {
      const index = definition.steps.length + offset;
      let cleaned: FunctionalTestStatus;
      try {
        cleaned = await runStep(step, index);
      } catch (error) {
        recordInterruption(index, error);
        emit(index, 'cleanup', '清理中断，保留已执行的步骤', { status: FunctionalTestStatus.Blocked });
        if (outcome === FunctionalTestStatus.Passed) outcome = FunctionalTestStatus.Blocked;
        break;
      }
      emit(index, 'cleanup', '测试数据清理', { status: cleaned });
      if (outcome === FunctionalTestStatus.Passed && cleaned !== FunctionalTestStatus.Passed)
        outcome = FunctionalTestStatus.Blocked;
    }
  } finally {
    await browser.close(owner.id);
    const output = redactText(logTail());
    if (output.length > 0) emit(null, 'environment', '测试期间的服务日志尾部', { logTail: output });
  }
  return outcome;
}
