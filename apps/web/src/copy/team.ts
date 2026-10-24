import { TeamGranularity, TeamPeriod, TeamWorkType } from '@aw/shared';

const NUMBER = new Intl.NumberFormat('zh-CN');
const PERCENT = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', timeZone: 'UTC' });

export const formatCount = (n: number) => NUMBER.format(n);
export const formatRate = (r: number | null) => (r === null ? '—' : PERCENT.format(r));
export const formatDecimal = (n: number | null) => (n === null ? '—' : DECIMAL.format(n));
/** A bucket's label: its first day, or the month for month buckets. */
export const formatBucket = (date: string, granularity: TeamGranularity) =>
  (granularity === TeamGranularity.Month ? MONTH : DAY).format(Date.parse(date));

/** 33: every figure says how it is counted; there are no scores and no rankings (D128). */
export const TEAM_COPY = {
  title: '团队',
  lede: '项目成员这段时间的提交、改动与质量信号。每个指标单独看，不打分、不排名。',
  noProjects: '还没有项目',
  noProjectsBody: '添加一个项目后，这里会按项目显示成员的工作。',
  switchProject: '切换项目',
  branch: '分支',
  localBranches: '本地分支',
  remoteBranches: '远端分支',
  periodLabel: '时间段',
  granularityLabel: '分桶',
  from: '开始日期',
  to: '结束日期',
  dataAsOf: (ref: string, time: string) => `数据截至 ${ref} 的最新提交（${time}）`,
  fetchedAt: (time: string) => `上次获取 ${time}`,
  neverFetched: '从未获取',
  fetch: '获取',
  fetched: '已获取远端的最新提交',
  scanning: (done: number, total: number) => `正在读取提交历史 ${formatCount(done)} / ${formatCount(total)}`,
  scanningStart: '正在读取提交历史…',
  empty: '这段时间没有提交',
  emptyBody: '换一个时间段或分支看看。',

  totalsTitle: '团队合计',
  activeMembers: (n: number) => `${n} 位成员有提交`,
  open: '查看',
  trendTitle: '每段时间的提交',
  trendTable: '每段时间的提交数',
  others: '其他',
  membersTitle: '成员',
  membersLede: '默认按姓名排列；点列头可按该列排序。最后一行是团队中位数（只算这段时间有提交的成员）。',
  medianRow: '团队中位数',
  compareTitle: '成员对比',
  compareMetric: '对比的指标',
  medianLine: (v: string) => `中位数 ${v}`,
  directoriesTitle: '模块分布',
  directoriesLede: '改动行数最多的目录，以及各成员在其中的占比。',
  rootDirectory: '根目录',
  othersTitle: (n: number) => `非成员的提交（${n}）`,
  othersLede: '本应用的 AI 任务（没有发起人记录的）与设为非成员的身份，不计入团队合计与中位数。',
  aiTask: '本应用的 AI 任务',
  hiddenIdentity: '非成员',

  linesNote: '行数受代码风格与 AI 影响，仅作参考；锁文件、构建产物与超大提交不计行数。',
  hugeNote: (n: number) => `${n} 个超大提交未计行数`,
  aiNote: '只能识别带标记的提交（本应用的任务、其他 AI 工具的 Co-Authored-By），没有标记的 AI 生成代码识别不了。',
  fixNote: '修复占比只描述工作内容，看不出修的是谁的问题，不代表质量好坏。',
  vsPrevious: '与上一段相比',

  metric: {
    commits: '提交',
    activeDays: '活跃天数',
    added: '新增行',
    deleted: '删除行',
    lines: '新增 / 删除行',
    files: '涉及文件',
    commitLinesMedian: '提交大小（中位数）',
    testRate: '测试伴随率',
    reverted: '被回滚',
    aiCommits: 'AI 参与',
    taskCommits: '经 AI 任务',
    fixShare: '修复占比',
  },
  metricHint: {
    commits: '进了这个分支的提交，合并提交不算',
    activeDays: '有提交的日期数',
    lines: '计入的文件的改动行数',
    files: '改过的文件数（去重）',
    commitLinesMedian: '每个提交改动行数的中位数；小而清楚的提交更易审查与回滚',
    testRate: '改了代码的提交中，同时改了测试的比例',
    reverted: '之后在这个分支上被回滚的提交',
    aiCommits: '带 AI 标记的提交',
  },

  member: '成员',
  back: '团队',
  emails: '身份',
  mergeInto: '合并到…',
  mergeTitle: (name: string) => `把「${name}」合并到另一位成员`,
  mergeLede: '同一个人用不同邮箱提交时，合并后按一位成员统计。',
  mergeTarget: '合并到',
  merge: '合并',
  unmerge: '拆开',
  rename: '改显示名',
  renameTitle: '显示名',
  renameLede: '只在本应用的团队页显示，不改提交记录。',
  save: '保存',
  hide: '设为非成员',
  unhide: '设为成员',
  hiddenBanner: '这个身份已设为非成员，不计入团队合计与中位数。',
  workMixTitle: '工作构成',
  workMixLede: '按提交标题的前缀（feat、fix、修复…）分类。',
  myDirectoriesTitle: '改动分布',
  commitsTitle: '提交',
  commitsLede: '点提交在 Git 工作台中查看。',
  loadMore: '加载更多',
  huge: '超大',
  revertedTag: '被回滚',
  aiTag: 'AI',
  viaTaskTag: 'AI 任务',
  noCommits: '这段时间没有提交',

  analysisTitle: 'AI 分析',
  analysisLede:
    'AI 读这段时间的提交，总结做了什么、亮点与值得关注之处（每条都附提交），并抽样评审改动最多的几个提交。不打分、不评级。',
  analyse: '生成分析',
  analyseAll: '为全部成员生成分析',
  analyseTitle: (name: string) => `分析「${name}」这段时间的工作`,
  analyseAllTitle: (n: number) => `为 ${n} 位成员生成分析`,
  analyseBody: (sample: number) =>
    `AI 会读这段时间的提交，并评审其中改动最多的至多 ${sample} 个提交。同一项目一次只分析一位成员，其余排队。`,
  analysePrivacy: '分析会把这位成员的提交与代码发给你设置的模型。',
  analyseStart: '开始分析',
  analysisStatus: {
    queued: '排队中',
    running: '分析中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  },
  cancelAnalysis: '取消',
  reanalyse: '重新生成',
  noAnalysis: '还没有这段时间的分析。',
  nothingToAnalyse: '这段时间没有提交，没有可以分析的工作。',
  analysisOf: (from: string, to: string, ref: string) => `${from} 至 ${to} · ${ref}`,
  history: '历史分析',
  workItems: '做了什么',
  strengths: '做得好的地方',
  concerns: '值得关注',
  findingsTitle: (n: number, lines: number) => `抽样评审：${n} 个提交，共 ${lines} 行`,
  noFindings: '抽样的提交没有发现问题。',
  noSample: '没有可以评审的提交（都是超大提交或没有计入的改动），只写了总结。',
  sampleNote: '抽样结果，样本小，仅作参考。',
  perKloc: (n: string) => `每千行 ${n} 个`,
  qualityColumn: 'AI 抽样评审',
  qualityHint: '阻断 + 严重的问题数（每千行）；悬停看全部',
  qualityCell: (blocker: number, major: number, minor: number) => `阻断 ${blocker} · 严重 ${major} · 一般 ${minor}`,

  settingsTitle: '统计口径',
  settingsLede: '每行一个 glob；修改后立即按新规则重新统计。',
  excludeGlobs: '不计行数的文件',
  testGlobs: '测试文件',
  hugeCommitLines: '超大提交的行数',
  hugeCommitLinesHint: '有效改动超过这个行数的提交只计提交数，不计行数。',
  resetDefaults: '恢复默认',
  settingsSaved: '已保存统计口径',
} as const;

export const TEAM_PERIOD_LABEL: Record<TeamPeriod, string> = {
  [TeamPeriod.Last30Days]: '近 30 天',
  [TeamPeriod.Last90Days]: '近 90 天',
  [TeamPeriod.Last180Days]: '近半年',
  [TeamPeriod.Last365Days]: '近一年',
  [TeamPeriod.Custom]: '自定义',
};

export const TEAM_GRANULARITY_LABEL: Record<TeamGranularity, string> = {
  [TeamGranularity.Day]: '按天',
  [TeamGranularity.Week]: '按周',
  [TeamGranularity.Month]: '按月',
};

export const WORK_TYPE_LABEL: Record<TeamWorkType, string> = {
  [TeamWorkType.Feature]: '功能',
  [TeamWorkType.Fix]: '修复',
  [TeamWorkType.Test]: '测试',
  [TeamWorkType.Refactor]: '重构与性能',
  [TeamWorkType.Docs]: '文档',
  [TeamWorkType.Chore]: '工程与杂项',
  [TeamWorkType.Other]: '未标注',
};
