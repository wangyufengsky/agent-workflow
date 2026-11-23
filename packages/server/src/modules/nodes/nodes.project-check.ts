import {
  ACCEPTANCE_OUTPUT_MAX_CHARS,
  AcceptanceCheckKind,
  AppError,
  ErrorCode,
  PROJECT_CHECK_PLACEHOLDER,
} from '@aw/shared';
import type { CommandCheckResult } from '../acceptance/index.ts';
import { runGit } from '../git/index.ts';
import type { NodeRunContext, NodesServiceDeps } from './nodes.types.ts';

/** 包括之前步骤已提交的修改、当前工作区及未跟踪文件。重命名的原模块也要参与验收。 */
async function taskChangedPaths(ctx: NodeRunContext): Promise<string[]> {
  const options = { cwd: ctx.directory, verbatim: true };
  const [tracked, untracked] = await Promise.all([
    runGit(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', ctx.baseCommit, '--'], options),
    runGit(['ls-files', '--others', '--exclude-standard', '-z'], options),
  ]);
  return [...new Set((tracked.stdout + untracked.stdout).split('\0').filter(Boolean))];
}

/** 已选中的 IDEA 配置返回实测结果；只有无法选择或解析时才使用冻结的项目命令。 */
export async function runAutomaticCheck(
  deps: NodesServiceDeps,
  ctx: NodeRunContext,
  command: string,
  signal: AbortSignal,
): Promise<CommandCheckResult | null> {
  const paths = await taskChangedPaths(ctx).catch((error: unknown) => {
    if (
      error instanceof AppError &&
      (error.code === ErrorCode.GitCommandFailed || error.code === ErrorCode.GitNotInstalled)
    )
      return null;
    throw error;
  });
  const selected =
    paths === null
      ? { kind: 'fallback' as const, reason: '无法读取任务相对起始提交的改动范围。' }
      : await deps.runIdeaCheck(ctx, paths, signal);
  if (signal.aborted || selected.kind === 'interrupted') return null;
  const base = { kind: AcceptanceCheckKind.Command, command, timedOut: false, unrunnable: null, exitCode: null };
  if (selected.kind === 'checked') {
    return {
      ...base,
      passed: selected.passed,
      skipped: false,
      output: selected.output.slice(-ACCEPTANCE_OUTPUT_MAX_CHARS),
      autoSelection: {
        source: 'idea',
        reason: '匹配到本次任务所改模块的 IDEA 配置。',
        configurations: selected.configurations,
      },
    };
  }
  const autoSelection = { source: 'fallback' as const, reason: selected.reason, configurations: [] };
  if (command === PROJECT_CHECK_PLACEHOLDER)
    return { ...base, passed: true, skipped: true, output: selected.reason, autoSelection };
  const result = await deps.acceptance.runCommand(ctx.directory, command, signal);
  return { ...result, autoSelection };
}
