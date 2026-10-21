import {
  type ScheduleFrequency,
  ScheduleFrequencyKind,
  ScheduleRunOutcome,
  ScheduleRunTrigger,
  ScheduleStatus,
} from '@aw/shared';

/** Default requirement of the built-in fixed workflows on the new-schedule page (22 §7); custom ones start empty. */
export const SCHEDULE_DEFAULT_REQUIREMENT: Readonly<Record<string, string>> = {
  unit_tests: '为最近改动的代码补充单元测试，覆盖主要行为与边界情况。',
  code_review: '审查最近的改动，列出问题、位置与改进建议。',
  bugfix: '修复以下问题：',
};

/** Index = `Date.getDay()`. */
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'] as const;
/** The week as the page lists it, Monday first. */
export const WEEKDAYS_SHOWN = [1, 2, 3, 4, 5, 6, 0] as const;
export const weekdayLabel = (day: number) => `周${WEEKDAY[day]}`;

/** 「每天 02:00」「每周一、三、五 09:00」「每 6 小时，从 00:30 起」(22 §2). */
export function frequencyText(frequency: ScheduleFrequency): string {
  switch (frequency.kind) {
    case ScheduleFrequencyKind.Daily:
      return `每天 ${frequency.time}`;
    case ScheduleFrequencyKind.Weekly: {
      const days = WEEKDAYS_SHOWN.filter((d) => frequency.weekdays.includes(d));
      const label = days.length === 7 ? '每天' : `每周${days.map((d) => WEEKDAY[d]).join('、')}`;
      return `${label} ${frequency.time}`;
    }
    case ScheduleFrequencyKind.Hourly:
      return `每 ${frequency.everyHours} 小时，从 ${frequency.time} 起`;
  }
}

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  [ScheduleStatus.Active]: '启用中',
  [ScheduleStatus.Paused]: '已暂停',
};

export const SCHEDULE_TRIGGER_LABEL: Record<ScheduleRunTrigger, string> = {
  [ScheduleRunTrigger.OnTime]: '准时',
  [ScheduleRunTrigger.CatchUp]: '补跑',
  [ScheduleRunTrigger.Manual]: '手动',
};

export const SCHEDULE_OUTCOME_LABEL: Record<ScheduleRunOutcome, string> = {
  [ScheduleRunOutcome.Started]: '开了任务',
  [ScheduleRunOutcome.Skipped]: '上一次还没结束，这次跳过了',
  [ScheduleRunOutcome.Failed]: '没能开始',
};

export const SCHEDULE_KIND_LABEL: Record<ScheduleFrequencyKind, string> = {
  [ScheduleFrequencyKind.Daily]: '每天',
  [ScheduleFrequencyKind.Weekly]: '每周',
  [ScheduleFrequencyKind.Hourly]: '每隔几小时',
};

export const SCHEDULES_COPY = {
  title: '定时任务',
  lede: '按时自动运行一个固定流程；每次开一个任务，结果在「需要你处理」等你确认，合并要你点。',
  newTitle: '新建定时任务',
  editTitle: '修改定时任务',
  create: '新建定时任务',
  empty: '还没有定时任务',
  emptyBody: '在主页的流程卡片上点「定时」，让它每天或每周自动运行。',
  /** The「定时」button on a fixed workflow card of the home page. */
  schedule: '定时',
  scheduleOf: (workflow: string) => `定时运行「${workflow}」`,
  runOnSchedule: '定时运行',
  project: '项目',
  workflow: '流程',
  noFixedWorkflow: '没有可定时运行的流程（只支持固定步骤的流程）。',
  requirement: '要做什么',
  frequency: '多久一次',
  time: '时间',
  weekdays: '哪几天',
  everyHours: '间隔',
  hours: (n: number) => `${n} 小时`,
  startAt: '从几点起',
  timesOfDay: (times: string) => `每天的运行时刻：${times}`,
  noWeekday: '至少选一天。',
  baseBranch: '基于分支',
  defaultBranch: '项目默认分支',
  whileOpen: '到点时应用要开着；应用没开时错过的，会在下次打开时补跑一次。',
  howResults: '每次运行开一个任务，结果在「需要你处理」等你确认，合并要你点。',
  submitCreate: '创建定时任务',
  submitSave: '保存',
  nextRun: (at: string) => `下次运行：${at}`,
  paused: '已暂停，不会自动运行',
  lastRun: '最近一次',
  noRuns: '还没有运行过',
  runNow: '立即运行一次',
  busy: '上一次运行的任务还没结束',
  pause: '暂停',
  resume: '恢复',
  edit: '修改',
  delete: '删除',
  deleteTitle: '删除这个定时任务？',
  deleteBody: '运行记录会一起删除；它开出的任务保留。',
  current: '正在进行',
  runs: '运行记录',
  columns: { when: '时间', trigger: '方式', outcome: '结果' },
  catchUp: (dueAt: string, missed: number) =>
    `原定 ${dueAt}（当时应用没开着）${missed > 0 ? `，另有 ${missed} 次错过` : ''}`,
  failedBecause: (reason: string) => `没能开始：${reason}`,
  pausedByFailure: '上次到点时没能开始任务，已自动暂停。修好原因后点「恢复」。',
  inProgress: '定时任务',
  viewAll: '全部定时任务',
  meta: (workflow: string, project: string) => `${workflow} · ${project}`,
  workflowDeleted: (key: string) => `${key}（流程已删除）`,
  fromSchedule: (title: string) => `定时任务「${title}」`,
  open: '查看定时任务',
} as const;
