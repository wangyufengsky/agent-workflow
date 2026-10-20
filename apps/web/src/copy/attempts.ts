import { AttemptKind, AttemptStatus, TranscriptSystemEvent } from '@aw/shared';

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
