import {
  attemptKindSchema,
  type FailureReasonDTO,
  InsightsDimension,
  InsightsDrill,
  InsightsFailureKind,
  InsightsPeriod,
} from '@aw/shared';
import { ATTEMPT_KIND_LABEL } from './attempts.ts';
import { ERROR_COPY } from './errors.ts';

const TOKENS = new Intl.NumberFormat('zh-CN');
const TOKENS_SHORT = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 19: figures are shown as they are; a missing denominator is a dash, never 0 %. */
export const INSIGHTS_COPY = {
  title: '质量与用量',
  lede: 'AI 帮你做了多少、做得怎样、用了多少。',
  simpleLede: '本周 AI 帮你做了多少、用了多少。',
  /** Leads the simple task list's line of the three figures (38 C1). */
  thisWeek: '本周',
  completed: (n: number) => `完成了 ${n} 个任务`,
  used: (tokens: string) => `用了 ${tokens} tokens`,
  interrupted: (n: number) => `打扰了你 ${n} 次`,
  completedHint: '本周完成并合并或交付的任务',
  usedHint: '本周 AI 读写的 tokens（输入与输出）',
  interruptedHint: 'AI 的提问与权限请求，不含按默认假设继续的提问',
  proHint: '在专业模式下查看按项目、流程、角色、模型的 tokens 拆分，每天的趋势和任务明细。',
  enablePro: '开启专业模式',

  periodLabel: '时间段',
  from: '开始日期',
  to: '结束日期',
  usageTitle: '用量',
  tokensInput: '输入 tokens',
  tokensOutput: '输出 tokens',
  tokensTotal: 'tokens 合计',
  attempts: 'AI 会话',
  assistantNotCounted: '本页统计任务与知识问答；助手的单轮和会话用量显示在对话输入框旁，不计入此页。',
  trendTitle: '每天的 tokens',
  trendTable: '每天的数据',
  date: '日期',
  breakdownTitle: '拆分',
  name: '名称',
  qualityTitle: '质量',
  qualityLede: '统计这段时间内结束的任务。',
  completionRate: '完成率',
  endedCompleted: (n: number) => `完成 ${n}`,
  endedCancelled: (n: number) => `取消 ${n}`,
  endedFailed: (n: number) => `失败 ${n}`,
  firstPassRate: '首次通过率',
  firstPassCounts: (pass: number, done: number) => `${done} 个完成的步骤中 ${pass} 个一次通过`,
  avgRetries: '平均重试',
  retryCounts: (retries: number, nodes: number) => `${nodes} 个步骤共重试 ${retries} 次`,
  avgInterruptions: '平均打扰',
  interruptionCounts: (n: number) => `共 ${n} 次提问与权限请求`,
  reviewDuration: '到待合并',
  reviewDurationHint: '从开始到第一次待合并的中位数',
  noEnded: '这段时间没有结束的任务',
  failuresTitle: '失败原因',
  noFailures: '这段时间结束的任务没有失败过的步骤。',
  times: (n: number) => `${n} 次`,
  tasksTitle: '任务明细',
  tasksLede: '这段时间结束或用到 AI 的任务。',
  noTasks: '没有符合的任务',
  columns: {
    task: '任务',
    project: '项目',
    status: '状态',
    tokens: 'tokens',
    retries: '重试',
    interruptions: '打扰',
    reviewDuration: '到待合并',
  },
  drilling: (what: string) => `正在查看：${what}`,
  clearDrill: '清除',
  emptyTitle: '这段时间没有 AI 活动',
  emptyBody: '开始一个任务或提一个问题后，这里会显示用量与质量。',
  dash: '—',
} as const;

export const PERIOD_LABEL: Record<InsightsPeriod, string> = {
  [InsightsPeriod.Today]: '今天',
  [InsightsPeriod.Week]: '本周',
  [InsightsPeriod.Last7Days]: '近 7 天',
  [InsightsPeriod.Last30Days]: '近 30 天',
  [InsightsPeriod.Custom]: '自定义',
};

export const DIMENSION_LABEL: Record<InsightsDimension, string> = {
  [InsightsDimension.Project]: '项目',
  [InsightsDimension.Workflow]: '流程',
  [InsightsDimension.Role]: '角色',
  [InsightsDimension.Model]: '模型',
  [InsightsDimension.Kind]: '用途',
};

/** Names of the groups whose key is null (19 §2.3). */
export const NULL_GROUP_NAME: Record<InsightsDimension, string> = {
  [InsightsDimension.Project]: '',
  [InsightsDimension.Workflow]: '知识问答',
  [InsightsDimension.Role]: '知识研究员',
  [InsightsDimension.Model]: 'opencode 默认模型',
  [InsightsDimension.Kind]: '',
};

export function groupName(dimension: InsightsDimension, key: string | null, name: string | null): string {
  if (key === null) return NULL_GROUP_NAME[dimension];
  switch (dimension) {
    case InsightsDimension.Model:
      return key;
    case InsightsDimension.Kind:
      return ATTEMPT_KIND_LABEL[attemptKindSchema.parse(key)];
    case InsightsDimension.Project:
    case InsightsDimension.Workflow:
    case InsightsDimension.Role:
      // The contract names every keyed group of these dimensions.
      if (name === null) throw new Error(`Group ${dimension}:${key} without a name`);
      return name;
  }
}

export function failureName(reason: Pick<FailureReasonDTO, 'kind' | 'code'>): string {
  switch (reason.kind) {
    case InsightsFailureKind.ChecksFailed:
      return '检查未通过';
    case InsightsFailureKind.Rejected:
      return '人工验收未通过';
    case InsightsFailureKind.AttemptError:
      return reason.code === null ? 'AI 会话出错' : ERROR_COPY[reason.code];
  }
}

/** What a drill-down shows; a group or failure reason is named by the caller. */
export function drillLabel(drill: InsightsDrill, name: string): string {
  switch (drill) {
    case InsightsDrill.Completed:
      return '已完成的任务';
    case InsightsDrill.Cancelled:
      return '已取消的任务';
    case InsightsDrill.Failed:
      return '失败的任务';
    case InsightsDrill.FirstPassMissed:
      return '有步骤没能一次通过的任务';
    case InsightsDrill.Retried:
      return '重试过的任务';
    case InsightsDrill.Interrupted:
      return '打扰过你的任务';
    case InsightsDrill.ReviewDuration:
      return '到过待合并的任务';
    case InsightsDrill.Failure:
      return `失败原因「${name}」`;
    case InsightsDrill.Project:
    case InsightsDrill.Workflow:
    case InsightsDrill.Role:
    case InsightsDrill.Model:
    case InsightsDrill.Kind:
      return `${DIMENSION_LABEL[drill]}「${name}」的用量`;
  }
}

export const formatTokens = (n: number) => TOKENS.format(n);
export const formatTokensShort = (n: number) => TOKENS_SHORT.format(n);
export const formatPercent = (ratio: number | null) => (ratio === null ? INSIGHTS_COPY.dash : PERCENT.format(ratio));
export const formatAverage = (value: number | null) => (value === null ? INSIGHTS_COPY.dash : DECIMAL.format(value));
/** A `YYYY-MM-DD` date as「1月6日」; the date is already the user's, so it is formatted as UTC. */
export const formatDay = (date: string) => DAY.format(Date.parse(date));

export function formatDuration(ms: number | null): string {
  if (ms === null) return INSIGHTS_COPY.dash;
  if (ms < MINUTE) return `${Math.round(ms / 1000)} 秒`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} 分钟`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}
