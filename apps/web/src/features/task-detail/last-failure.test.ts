import { ErrorCode, type NodeDetailDTO } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { lastFailure } from './last-failure.ts';

const attempt = (status: string, error: { code: string; message: string } | null = null) => ({
  kind: 'execute',
  status,
  error,
});
const command = (passed: boolean, skipped = false) => ({
  kind: 'command',
  command: 'pnpm test',
  passed,
  output: 'FAIL a.test.ts',
  exitCode: passed ? 0 : 1,
  timedOut: false,
  unrunnable: null,
  skipped,
});
const review = { kind: 'ai_review', focus: null, passed: false, output: 'Misses a case', attemptId: 'r', issues: [] };
const node = (attempts: unknown[], checkResults: unknown[] | null) =>
  ({ attempts, checkResults }) as unknown as NodeDetailDTO;

describe('失败步骤最后一次为什么没完成（D118）', () => {
  it('提交了结果：取第一条没通过、也没被跳过的检查', () => {
    expect(lastFailure(node([attempt('succeeded')], [command(true), review]))).toMatchObject({
      kind: 'review',
      check: { output: 'Misses a case' },
    });
    expect(lastFailure(node([attempt('succeeded')], [command(false, true), command(false)]))).toMatchObject({
      kind: 'command',
      check: { skipped: false, exitCode: 1 },
    });
  });

  it('最后一次没有提交结果：说的是那次尝试，而不是更早一次的检查', () => {
    const noResult = { code: ErrorCode.AttemptNoResult, message: 'No result' };
    expect(lastFailure(node([attempt('succeeded'), attempt('failed', noResult)], [command(false)]))).toEqual({
      kind: 'attempt',
      aborted: false,
      error: noResult,
    });
  });

  it('没有运行过，或检查都通过了：没有可说的原因', () => {
    expect(lastFailure(node([], null))).toBeNull();
    expect(lastFailure(node([attempt('succeeded')], [command(true)]))).toBeNull();
  });
});
