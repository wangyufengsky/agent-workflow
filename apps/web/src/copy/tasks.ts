import {
  CheckUnrunnableReason,
  ErrorCode,
  InboxKind,
  NodeStatus,
  PageCheckUnrunnable,
  TaskDisplayGroup,
} from '@aw/shared';

export const TASK_DISPLAY_LABEL: Record<TaskDisplayGroup, string> = {
  [TaskDisplayGroup.Preparing]: '准备中',
  [TaskDisplayGroup.PlanReview]: '待确认计划',
  [TaskDisplayGroup.Running]: '执行中',
  [TaskDisplayGroup.Paused]: '已暂停',
  [TaskDisplayGroup.NeedsAttention]: '需要你处理',
  [TaskDisplayGroup.Review]: '待合并',
  [TaskDisplayGroup.Merging]: '合并中',
  [TaskDisplayGroup.Completed]: '已完成',
  [TaskDisplayGroup.Failed]: '失败',
  [TaskDisplayGroup.Cancelled]: '已取消',
};

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  [NodeStatus.Pending]: '等待中',
  [NodeStatus.Ready]: '即将开始',
  [NodeStatus.Running]: '进行中',
  [NodeStatus.WaitingInput]: '等你回答',
  [NodeStatus.Verifying]: '检查中',
  [NodeStatus.AwaitingAcceptance]: '等你验收',
  [NodeStatus.Done]: '已完成',
  [NodeStatus.Failed]: '失败',
  [NodeStatus.Skipped]: '已跳过',
  [NodeStatus.Cancelled]: '已取消',
};

export const HOME_TASK_COPY = {
  project: '项目',
  workflow: '流程',
  requirement: '需求',
  requirementPlaceholder: '描述你的需求……（支持粘贴长文本）',
  confirmPlan: '运行前让我确认计划',
  start: '开始',
  needsRequirement: '先描述需求',
  needsWorkflow: '先选择项目和流程',
  /** After the platform's modifier key (`MOD_KEY`). */
  startShortcut: '↵',
  noProjectTitle: '先添加一个项目',
  noProjectBody: '选择一个本地 Git 仓库，AI 会在独立的分支和工作区里完成任务。',
  addProject: '添加项目',
  attention: (n: number) => `需要你处理（${n}）`,
  viewAll: '查看全部',
  inProgress: '进行中',
  toMerge: '待合并',
  recent: '最近完成',
  noneInProgress: '还没有任务。选一个流程写下需求，或者直接告诉助手，AI 会在独立工作区里完成它。',
  moreOptions: '更多选项',
  title: '标题',
  titlePlaceholder: '默认取需求的第一行',
  baseBranch: '基于分支',
  defaultBranch: (name: string) => `项目默认分支（${name}）`,
  acceptEachNode: '每个步骤由我验收',
  askOnUncertainty: '不确定时停下来问我',
  saveDraft: '保存草稿',
} as const;

export const TASKS_COPY = {
  title: '任务',
  lede: '所有任务按最近更新排列。',
  allProjects: '全部项目',
  allStates: '全部状态',
  columns: { title: '标题', project: '项目', workflow: '流程', status: '状态', updated: '更新时间' },
  empty: '还没有任务',
  emptyBody: '在主页描述需求即可开始第一个任务。',
} as const;

export const TASK_COPY = {
  back: '← 任务',
  meta: (key: string, project: string, workflow: string) => `${key} · ${project} · ${workflow}`,
  doing: '正在：',
  // 执行中的进度与耗时（D118）
  stepsDone: (done: number, total: number) => `已完成 ${done} / ${total} 步`,
  elapsed: (ms: number) => {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return '刚开始';
    return minutes < 60 ? `已用 ${minutes} 分钟` : `已用 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
  },
  sideCurrent: '当前步骤',
  showDetails: '显示详细信息',
  startDraft: '开始',
  draft: '草稿：还没有开始，开始后会建立独立工作区。',
  hideDetails: '隐藏详细信息',
  pause: '暂停',
  paused: '任务已暂停：进行中的步骤会做完，不会开始新的步骤',
  resume: '继续执行',
  resumed: '已继续执行',
  // 编辑计划（专业）
  editPlan: '编辑计划',
  saveEdits: '保存修改',
  cancelEdits: '放弃修改',
  planSaved: (v: number) => `已保存为第 ${v} 版`,
  adjustPlan: '调整计划',
  adjustHint: '只能修改还没开始的步骤；保存后确认调整才会生效，任务继续保持暂停。',
  draftPending: (v: number) => `有未确认的调整（第 ${v} 版）`,
  confirmAdjust: '确认调整',
  adjusted: '计划已调整',
  resumeDiscards: '继续执行会放弃未确认的调整。',
  cancel: '取消任务',
  cancelTitle: '取消这个任务？',
  cancelBody: 'AI 会话会被中止，独立工作区和分支会被删除，已经完成的改动不会保留。',
  cancelConfirm: '取消任务',
  cancelled: '任务已取消',
  // 准备中 / 规划中
  stagePreparing: '建立独立工作区',
  stagePlanning: 'AI 正在阅读代码并规划',
  stageWaiting: '等待开始',
  planningNow: '当前进展',
  lastAction: '最近的操作',
  // 待确认计划
  planTitle: 'AI 的计划',
  planVersion: (v: number) => `第 ${v} 版`,
  assumptions: '假设',
  planSteps: (n: number) => `步骤（${n}）`,
  confirmPlan: '确认并开始',
  replan: '按意见重新规划',
  replanPlaceholder: '告诉 AI 计划要怎么改……',
  replanSend: '发送意见',
  planConfirmed: '计划已确认',
  // 失败
  failedTitle: '任务没有完成',
  failedPhase: { preparing: '准备工作区时', planning: '规划时', running: '执行步骤时', merging: '合并时' },
  failedStep: (title: string) => `执行步骤「${title}」时多次尝试仍没有完成。`,
  failedCheck: (title: string, command: string) => `步骤「${title}」多次尝试后，检查 \`${command}\` 仍没有通过。`,
  retry: '重试',
  retried: '已重新开始',
  // 失败的原因与出口（D118）
  lastCommand: (command: string, exitCode: number | null, timedOut: boolean) =>
    `最后一次运行 \`${command}\` ${timedOut ? '超时了' : `退出码为 ${exitCode}`}，输出的最后几行：`,
  lastReview: '最后一次 AI 评审没有通过：',
  lastPage: '最后一次页面体检没有通过：',
  lastAttempt: (aborted: boolean, code: string | undefined) => {
    if (aborted) return 'AI 最后一次的尝试被中止了。';
    switch (code) {
      case ErrorCode.AttemptNoResult:
        return 'AI 最后一次没有提交结果就停下了。';
      case ErrorCode.AttemptTimeout:
        return 'AI 最后一次超时了。';
      case ErrorCode.AttemptSessionError:
        return 'AI 最后一次的会话出错了，模型服务返回：';
      default:
        return 'AI 最后一次没有完成这一步。';
    }
  },
  fullOutput: '展开全部输出',
  tailOutput: '只看最后几行',
  keptSteps: (n: number) => `已完成的 ${n} 个步骤会保留，重试从这一步继续。`,
  retryWithNote: '带上说明重试…',
  retryNoteTitle: '带上说明重试',
  retryNoteBody: '这句说明会随这一步的下一次尝试一起交给 AI，例如「测试前要先启动本地数据库」。',
  retryNoteField: '给 AI 的说明',
  retryNotePlaceholder: '告诉 AI 这次要注意什么……',
  viewStepProcess: '查看这一步的过程',
  // 检查命令无法运行（D116）
  unrunnable: (step: string, command: string, program: string, reason: CheckUnrunnableReason) =>
    `步骤「${step}」的检查命令 \`${command}\` ${
      reason === CheckUnrunnableReason.NotFound
        ? `在应用环境里找不到程序 \`${program}\``
        : `里的程序 \`${program}\` 没有执行权限`
    }。这不是 AI 的问题：代码没有被判为不通过，AI 也没有重做。`,
  recheck: '重新检查',
  rechecked: '正在重新检查',
  pageUnrunnable: (step: string, reason: PageCheckUnrunnable) =>
    `步骤「${step}」的页面体检没法运行：${
      reason === PageCheckUnrunnable.PreviewNeverStarted
        ? '页面预览在这个任务的工作区里一直没有启动起来'
        : '项目的页面预览设置已删除'
    }。这不是 AI 的问题：代码没有被判为不通过，AI 也没有重做。`,
  pageUnrunnableLog: '预览日志末尾',
  editPreview: '修改页面预览设置',
  skipPageCheckBody: '跳过后，这个任务之后的步骤都不再做页面体检，结果标为「未验证」。合并前请自己打开页面确认。',
  editCheck: '修改检查命令…',
  editCheckTitle: '修改检查命令',
  editCheckBody: '这个任务里还没完成的步骤都改用新命令，然后用 AI 已经交的结果重新检查。',
  editCheckField: '检查命令',
  editCheckProject: '同时设为项目的检查命令',
  editCheckSave: '保存并重新检查',
  skipCheck: '跳过这项检查…',
  skipCheckTitle: '跳过这项检查',
  skipCheckBody: (command: string) =>
    `跳过后，这个任务之后的步骤都不再运行 \`${command}\`，结果标为「未验证」。合并前请自己确认代码能通过检查。`,
  skipCheckConfirm: '跳过并继续',
  checkSkipped: '已跳过这项检查',
  // 结果卡
  resultHeadline: (steps: number, files: number, add: number, del: number) =>
    `已完成 ${steps} 个步骤 · 改动 ${files} 个文件 +${add} −${del}`,
  checksPassed: '检查全部通过',
  checksFailed: (n: number) => `${n} 项检查未通过`,
  checksSkipped: (n: number, checks: readonly string[]) => `有 ${n} 项检查没有运行：${checks.join('、')}（已跳过）`,
  prUnverified: (checks: readonly string[]) => `未验证：应用环境无法运行检查 ${checks.join('、')}，已跳过。`,
  noChecks: '没有自动检查',
  summary: '摘要',
  changedFiles: '改动文件',
  report: '审查报告',
  resultPending: '正在汇总结果…',
  canvasToggle: '查看步骤',
  // 侧栏
  sideAttention: '需要你处理',
  sideNode: '步骤',
  sideNodeEmpty: '点击画布中的步骤查看摘要。',
  viewNode: '查看详情',
  viewNodePage: '完整详情',
  attempts: (n: number) => `尝试 ${n} 次`,
  skip: '跳过',
  skipped: '已跳过这个步骤',
  retryNode: '重跑',
  retriedNode: '已重新开始这个步骤',
  abort: '中止',
  aborted: '已中止这次尝试',
} as const;

export const NODE_COPY = {
  output: '产出',
  changes: '改动',
  changesOf: (step: string) => `改动 · ${step}`,
  process: '过程',
  summary: '摘要',
  assumptions: '假设',
  notes: '注意事项',
  checks: '检查',
  checkPassed: '通过',
  checkFailed: '未通过',
  checkSkipped: '已跳过',
  checking: '正在检查这一次的结果……',
  checkUnrunnable: '无法运行',
  unrunnableHint: (program: string, reason: CheckUnrunnableReason) =>
    reason === CheckUnrunnableReason.NotFound ? `找不到程序 ${program}` : `程序 ${program} 没有执行权限`,
  commandCheck: (command: string) => `运行 ${command}`,
  reviewCheck: 'AI 评审',
  pageCheck: '页面体检',
  timedOut: '超时',
  noResult: '还没有产出。',
  retryFeedback: '上次未通过的原因',
  changesEmpty: '这一步没有记录改动。',
  commit: (sha: string) => `提交 ${sha.slice(0, 8)}`,
  noAttempt: '这一步还没有开始。',
} as const;

export const NODE_PAGE_COPY = {
  back: (key: string, title: string) => `← ${key} · ${title}`,
  actions: '操作',
  instructions: '指令',
} as const;

export const INBOX_COPY = {
  title: '需要你处理',
  lede: 'AI 遇到需要你决定的事情时会出现在这里，处理后任务会继续；做完、等你合并的结果列在最后。',
  // 两组（D119）
  waiting: '等你回答或决定',
  noneWaiting: '没有等你回答或决定的事情。',
  toMerge: '等你合并',
  empty: '没有需要处理的事情',
  emptyBody: 'AI 提问、请求权限或需要你验收时会出现在这里。',
  open: (n: number) => (n === 0 ? '需要你处理' : `需要你处理（${n}）`),
  kind: {
    [InboxKind.Question]: 'AI 提问',
    [InboxKind.Permission]: '权限请求',
    [InboxKind.Acceptance]: '等你验收',
    [InboxKind.Plan]: '计划待确认',
    [InboxKind.Failure]: '任务失败',
    [InboxKind.Delivery]: '待合并',
    [InboxKind.ScheduleFailure]: '定时任务没能开始',
  },
  blocking: 'AI 在等这个答案',
  defaultAssumption: '不回答时 AI 会假设：',
  answerPlaceholder: '输入你的回答……',
  submit: '提交',
  answered: '已发送回答',
  wantsTo: 'AI 想要执行',
  allowOnce: '允许一次',
  allowAlways: '总是允许',
  alwaysRemembers: (patterns: string) =>
    `「总是允许」会为本项目记住 ${patterns}，之后的会话不再询问；可在项目设置中撤销。`,
  reject: '拒绝',
  accept: '通过',
  rejectStep: '驳回',
  rejectPlaceholder: '说明需要怎么改……',
  confirmPlan: '去确认',
  retry: '重试',
  cancelTask: '取消任务',
  viewResult: '去查看',
  dismiss: '忽略',
  inTask: (key: string, title: string) => `${key} · ${title}`,
  inStep: (title: string) => `步骤「${title}」`,
  fromKnowledge: '知识问答',
  fromPpt: 'PPT',
  planBody: (version: number) => `AI 写好了计划（第 ${version} 版），确认后开始执行。`,
  deliveryReady: '结果已经就绪，等你合并或创建 PR。',
  viewAll: '查看全部',
  done: '已处理',
} as const;
