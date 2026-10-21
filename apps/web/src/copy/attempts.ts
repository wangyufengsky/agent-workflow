import { AttemptKind, AttemptStatus, McpToolName, TranscriptSystemEvent } from '@aw/shared';
import type { ActionState, ToolAction } from '../features/attempts/process-lines.ts';
import { formatDateTimeSeconds, formatTimeSeconds } from './common.ts';

export const ATTEMPT_STATUS_LABEL: Record<AttemptStatus, string> = {
  [AttemptStatus.Starting]: '启动中',
  [AttemptStatus.Running]: '进行中',
  [AttemptStatus.Succeeded]: '已提交结果',
  [AttemptStatus.Failed]: '失败',
  [AttemptStatus.Aborted]: '已中止',
  [AttemptStatus.Interrupted]: '已中断',
};

export const ATTEMPT_KIND_LABEL: Record<AttemptKind, string> = {
  [AttemptKind.Plan]: '规划',
  [AttemptKind.Execute]: '执行',
  [AttemptKind.Review]: '评审',
  [AttemptKind.Research]: '知识研究',
};

export const TRANSCRIPT_SYSTEM_LABEL: Record<TranscriptSystemEvent, string> = {
  [TranscriptSystemEvent.AttemptStarted]: '会话开始',
  [TranscriptSystemEvent.Nudged]: 'AI 停下但没有提交结果，已提醒它提交',
  [TranscriptSystemEvent.Retrying]: '模型请求失败，opencode 稍后重试',
  [TranscriptSystemEvent.ResultSubmitted]: 'AI 已提交结果',
  [TranscriptSystemEvent.AwaitingInput]: '等待你回答问题或授权',
  [TranscriptSystemEvent.TimedOut]: '超过时限，已中止会话',
  [TranscriptSystemEvent.Aborted]: '已中止会话',
  [TranscriptSystemEvent.RuntimeLost]: 'opencode 已退出，会话中断',
};

export const ATTEMPT_COPY = {
  title: (kind: AttemptKind, seq: number) => `${ATTEMPT_KIND_LABEL[kind]}尝试 #${seq}`,
  progress: '当前进展',
  model: '模型',
  defaultModel: 'opencode 默认',
  nudges: '提醒次数',
  tokens: '用量',
  tokenUsage: (input: number, output: number) => `输入 ${input} · 输出 ${output} tokens`,
  cost: '成本',
  costValue: (usd: number) => `$${usd.toFixed(4)}`,
  time: '时间',
  timeRange: (start: number, end: number | null) =>
    `${formatDateTimeSeconds(start)} → ${end === null ? '进行中' : formatTimeSeconds(end)}`,
  error: '错误',
  abort: '中止',
  transcript: '会话流',
  transcriptEmpty: '还没有内容。',
  userMessage: '发给 AI 的消息',
  reasoning: '思考',
  toolCall: (tool: string) => `调用 ${tool}`,
  toolResult: (tool: string) => `${tool} 的结果`,
  toolFailed: (tool: string) => `${tool} 出错`,
  permission: (permission: string, patterns: string) => `请求权限：${permission} ${patterns}`,
} as const;

export const DEBUG_COPY = {
  title: '调试：发起一次执行尝试',
  hint: '仅开发构建可见。在指定的 Git 目录里直接运行一次执行会话，不创建任务；AI 提交结果即结束。',
  directory: 'Git 目录',
  directoryPlaceholder: '/Users/me/projects/demo',
  requirement: '要求',
  requirementPlaceholder: '例如：在 README 末尾加一行说明',
  model: '模型（可选）',
  modelPlaceholder: 'provider/model，留空使用设置或 opencode 默认',
  start: '开始',
} as const;

/** Our execution MCP tools as the simple process view names them (14 §3.4). */
const APP_TOOL_LABEL: Record<McpToolName, string> = {
  [McpToolName.GetTaskContext]: '读取任务背景',
  [McpToolName.GetNodeOutput]: '读取前面步骤的产出',
  [McpToolName.GetTaskDiff]: '查看任务的改动',
  [McpToolName.SubmitPlan]: '提交计划',
  [McpToolName.SubmitResult]: '提交结果',
  [McpToolName.SubmitReview]: '提交评审意见',
  [McpToolName.AskUser]: '向你提问',
  [McpToolName.ReportProgress]: '进展',
  [McpToolName.DbListConnections]: '查看可用的数据库',
  [McpToolName.DbDescribe]: '查看表结构',
  [McpToolName.DbQuery]: '查询数据库',
  [McpToolName.SubmitAnswer]: '提交回答',
};

/** One tool call in the user's words:「编辑 src/a.ts +12 −3」「运行 pnpm test」. */
export function toolActionLabel(action: ToolAction): string {
  switch (action.kind) {
    case 'edit':
      return `编辑 ${action.path} +${action.added} −${action.removed}`;
    case 'write':
      return `写入 ${action.path} +${action.lines}`;
    case 'read':
      return `查看 ${action.path}`;
    case 'run':
      return `运行 ${action.command}`;
    case 'search':
      return `搜索 ${action.query}`;
    case 'fetch':
      return `打开网页 ${action.url}`;
    case 'todo':
      return '整理待办';
    case 'app':
      return action.detail === undefined || action.detail === ''
        ? APP_TOOL_LABEL[action.name]
        : `${APP_TOOL_LABEL[action.name]}：${action.detail}`;
    case 'other':
      return `使用工具 ${action.tool}`;
  }
}

export const PROCESS_COPY = {
  now: '当前进展',
  empty: 'AI 还没有开始写内容。',
  state: { running: '进行中', ok: '成功', failed: '失败' } satisfies Record<ActionState, string>,
  permission: (permission: string, patterns: string) => `请求权限：${permission} ${patterns}`,
} as const;
