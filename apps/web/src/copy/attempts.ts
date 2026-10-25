import { AttemptKind, AttemptStatus, McpToolName, TranscriptSystemEvent } from '@aw/shared';
import type { StreamAction, ToolAction } from '../features/stream/stream-items.ts';

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
  [AttemptKind.DeckOutline]: 'PPT 大纲',
  [AttemptKind.DeckSlides]: 'PPT 页面',
  [AttemptKind.GitReview]: 'Git 审查',
  [AttemptKind.TeamAnalysis]: '成员分析',
  [AttemptKind.Breakdown]: '需求拆解',
  [AttemptKind.CommitMessage]: '草拟提交信息',
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
  [TranscriptSystemEvent.AssistantIsolated]: '对话将使用独立文件目录，聊天记录保留，最近文字作为参考恢复',
};

export const ATTEMPT_COPY = {
  defaultModel: 'opencode 默认',
  tokenUsage: (input: number, output: number) => `输入 ${input} · 输出 ${output} tokens`,
  abort: '中止',
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
  [McpToolName.ReadAttachment]: '读取附加的资料',
  [McpToolName.SubmitPlan]: '提交计划',
  [McpToolName.SubmitResult]: '提交结果',
  [McpToolName.SubmitReview]: '提交评审意见',
  [McpToolName.AskUser]: '向你提问',
  [McpToolName.ReportProgress]: '进展',
  [McpToolName.DbListConnections]: '查看可用的数据库',
  [McpToolName.DbDescribe]: '查看表结构',
  [McpToolName.DbQuery]: '查询数据库',
  [McpToolName.SubmitAnswer]: '提交回答',
  [McpToolName.SubmitOutline]: '提交大纲',
  [McpToolName.SubmitSlide]: '提交一页',
  [McpToolName.SubmitFindings]: '提交审查问题',
  [McpToolName.SubmitMemberAnalysis]: '提交成员分析',
  [McpToolName.SubmitBreakdown]: '提交需求拆解',
  [McpToolName.SubmitCommitMessage]: '提交草拟的提交信息',
  [McpToolName.BrowserOpen]: '打开页面',
  [McpToolName.BrowserSnapshot]: '读取页面',
  [McpToolName.BrowserClick]: '点击',
  [McpToolName.BrowserType]: '输入',
  [McpToolName.BrowserSelect]: '选择',
  [McpToolName.BrowserPress]: '按键',
  [McpToolName.BrowserWaitFor]: '等待页面',
  [McpToolName.BrowserInspect]: '查看元素',
  [McpToolName.BrowserLogs]: '查看控制台',
  [McpToolName.BrowserViewport]: '切换尺寸',
  [McpToolName.BrowserScreenshot]: '截图',
};

/** One tool call in the user's words, as a verb and what it works on:「编辑」「src/a.ts」. */
export function toolActionText(action: ToolAction): { verb: string; subject: string } {
  switch (action.kind) {
    case 'edit':
      return { verb: '编辑', subject: action.path };
    case 'write':
      return { verb: '写入', subject: action.path };
    case 'read':
      return { verb: '查看', subject: action.path };
    case 'run':
      return { verb: '运行', subject: action.command };
    case 'search':
      return { verb: '搜索', subject: action.query };
    case 'fetch':
      return { verb: '打开网页', subject: action.url };
    case 'todo':
      return { verb: '整理待办', subject: '' };
    case 'app':
      return { verb: APP_TOOL_LABEL[action.name], subject: action.detail ?? '' };
    case 'other':
      return { verb: '使用工具', subject: action.tool };
  }
}

/** The lines a call added and removed, when it edits a file:「+12 −3」. */
export function toolActionDelta(action: ToolAction): { added: number; removed: number } | undefined {
  if (action.kind === 'edit') return { added: action.added, removed: action.removed };
  if (action.kind === 'write') return { added: action.lines, removed: 0 };
  return undefined;
}

/** One tool call as one line:「编辑 src/a.ts +12 −3」「运行 pnpm test」. */
export function toolActionLabel(action: ToolAction): string {
  const { verb, subject } = toolActionText(action);
  const delta = toolActionDelta(action);
  return [verb, subject, delta === undefined ? '' : `+${delta.added} −${delta.removed}`]
    .filter((p) => p !== '')
    .join(' ');
}

const GROUP_PARTS: [ToolAction['kind'][], (n: number) => string][] = [
  [['read'], (n) => `查看 ${n} 个文件`],
  [['search', 'fetch'], (n) => `搜索 ${n} 次`],
  [['edit', 'write'], (n) => `编辑 ${n} 个文件`],
  [['run'], (n) => `运行 ${n} 条命令`],
  [['app', 'todo', 'other'], (n) => `${n} 个其他动作`],
];

/** A folded run of calls:「查看 3 个文件 · 搜索 2 次 · 1 个失败」. */
export function actionGroupSummary(actions: readonly StreamAction[]): string {
  const parts = GROUP_PARTS.flatMap(([kinds, label]) => {
    const n = actions.filter((a) => kinds.includes(a.action.kind)).length;
    return n === 0 ? [] : [label(n)];
  });
  const failed = actions.filter((a) => a.state === 'failed').length;
  return [...parts, ...(failed === 0 ? [] : [`${failed} 个失败`])].join(' · ');
}

export const STREAM_COPY = {
  processTitle: '执行过程',
  reviewTitle: '评审过程',
  researchTitle: '研究过程',
  attemptTitle: (kind: AttemptKind, seq: number) => `${ATTEMPT_KIND_LABEL[kind]} #${seq}`,
  empty: 'AI 还没有开始。',
  /** A notice and what it comes with, e.g. why opencode retries (D163). */
  noticeDetail: (label: string, detail: string) => `${label}：${detail}`,
  summary: (status: string, thoughts: number, actions: number, duration: string) =>
    [status, thoughts === 0 ? '' : `思考 ${thoughts} 段`, `${actions} 个动作`, `用时 ${duration}`]
      .filter((p) => p !== '')
      .join(' · '),
  duration: (ms: number) => {
    const s = Math.max(1, Math.round(ms / 1000));
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
  },
  pro: (model: string, tokens: string | null, nudges: number) =>
    [model, tokens ?? '', `提醒 ${nudges} 次`].filter((p) => p !== '').join(' · '),
  thinking: '正在思考',
  thought: (seconds: number) => `思考了 ${seconds} 秒`,
  thinkingDone: '思考',
  prompt: '发给 AI 的消息',
  more: '展开全部',
  less: '收起',
  latest: '回到最新',
  unseen: (n: number) => `${n} 条新内容`,
  toggle: (title: string) => `展开或收起${title}`,
  progress: 'AI 汇报：',
  wait: (permission: string, patterns: string) => `等待你允许：${permission} ${patterns}`,
  goHandle: '去处理',
  state: { running: '进行中', ok: '成功', failed: '失败', stopped: '已中断' } satisfies Record<
    StreamAction['state'],
    string
  >,
  failedNote: '失败',
  frame: '画面',
  toolName: '内部工具名',
  input: '输入',
  output: '输出',
} as const;
