import { BatchDeliveryOutcome, DeliveryStatus } from '@aw/shared';

/** Default requirement template of the built-in fixed workflows (20 §2); custom ones start from the placeholder. */
export const BATCH_DEFAULT_TEMPLATE: Readonly<Record<string, string>> = {
  unit_tests: '为 {{target}} 补充单元测试，覆盖主要行为与边界情况。',
  code_review: '审查 {{target}} 的代码，列出问题、位置与改进建议。',
  bugfix: '修复 {{target}} 中的问题：',
};

export const BATCH_OUTCOME_LABEL: Record<BatchDeliveryOutcome, string> = {
  [BatchDeliveryOutcome.Delivered]: '已完成',
  [BatchDeliveryOutcome.Conflict]: '有冲突',
  [BatchDeliveryOutcome.Failed]: '合并失败',
};

/** How the current round's delivery of a task waiting in review went, shown after its state. */
export const BATCH_DELIVERY_NOTE: Partial<Record<DeliveryStatus, string>> = {
  [DeliveryStatus.Conflict]: '有冲突',
  [DeliveryStatus.Failed]: '合并失败',
};

export const BATCHES_COPY = {
  title: '批量任务',
  lede: '用一个固定流程，一次对多个目标各开一个任务。',
  newTitle: '新建批量任务',
  newLede: '每个目标都是一个普通任务，有自己的分支和工作区；同时运行的数量受设置中的并发上限约束。',
  create: '新建批量任务',
  empty: '还没有批量任务',
  emptyBody: '在主页的流程卡片上点「批量」，一次为多个目录或模块开任务。',
  /** The「批量」button on a fixed workflow card of the home page. */
  batch: '批量',
  batchOf: (workflow: string) => `批量运行「${workflow}」`,
  runAsBatch: '批量运行',
  project: '项目',
  workflow: '流程',
  noFixedWorkflow: '没有可批量运行的流程（只支持固定步骤的流程）。',
  template: '需求模板',
  templateHint: '{{target}} 会替换为每个目标，可以出现多次。',
  templateMissing: '需求模板里要有 {{target}}。',
  targets: '目标',
  pickTab: '从项目中选择',
  linesTab: '按行输入',
  linesLabel: '目标（每行一个）',
  linesPlaceholder: 'src/order/\nsrc/payment/\nUserService',
  root: '根目录',
  open: (name: string) => `进入 ${name}`,
  select: (path: string) => `选择 ${path}`,
  emptyDir: '这个目录是空的。',
  selected: (n: number) => `已选 ${n} 个目标`,
  tooMany: (max: number) => `一次最多 ${max} 个目标。`,
  duplicate: '目标有重复。',
  preview: '预览',
  submit: (n: number) => `创建 ${n} 个任务`,
  /** After the platform's modifier key (`MOD_KEY`). */
  submitShortcut: '↵',
  placeholderChip: '目标',
  progress: (done: number, total: number) => `${done} / ${total} 已结束`,
  allFinished: '已全部结束',
  columns: { target: '目标', task: '任务', state: '状态', activity: '进展' },
  deliverAll: (n: number) => `合并全部待合并的（${n}）`,
  finishAll: (n: number) => `完成全部待完成的报告（${n}）`,
  deliverTitle: (n: number) => `合并 ${n} 个任务？`,
  deliverBody: (branch: string) => `将依次合并到 ${branch}。某个任务有冲突或合并失败时它会停下等你处理，其余照常合并。`,
  finishTitle: (n: number) => `完成 ${n} 份报告？`,
  finishBody: '报告类任务没有代码要合并，完成后任务结束。',
  confirmDeliver: '合并',
  confirmFinish: '完成',
  outcome: (delivered: number, conflict: number, failed: number) =>
    [`已完成 ${delivered} 个`, conflict > 0 ? `${conflict} 个有冲突` : '', failed > 0 ? `${failed} 个合并失败` : '']
      .filter((s) => s !== '')
      .join('，'),
  inProgress: '批量任务',
  viewAll: '全部批量任务',
  meta: (workflow: string, project: string) => `${workflow} · ${project}`,
} as const;
