import { RoleBaseAgent, WorkflowDeliverable, WorkflowKind, WorkflowPlanning } from '@aw/shared';

export const WORKFLOW_KIND_LABEL: Record<WorkflowKind, string> = {
  [WorkflowKind.Builtin]: '内置',
  [WorkflowKind.Custom]: '自定义',
  [WorkflowKind.System]: '系统',
};

export const WORKFLOW_PLANNING_LABEL: Record<WorkflowPlanning, string> = {
  [WorkflowPlanning.Fixed]: '固定步骤',
  [WorkflowPlanning.Ai]: 'AI 规划',
};

export const WORKFLOW_DELIVERABLE_LABEL: Record<WorkflowDeliverable, string> = {
  [WorkflowDeliverable.CodeChanges]: '代码改动',
  [WorkflowDeliverable.Report]: '报告',
};

export const ROLE_BASE_AGENT_LABEL: Record<RoleBaseAgent, string> = {
  [RoleBaseAgent.Planner]: '规划（只读）',
  [RoleBaseAgent.Executor]: '执行（可改代码）',
  [RoleBaseAgent.Reviewer]: '评审（只读）',
};

export const WORKFLOWS_COPY = {
  title: '流程',
  lede: '内置流程只读，复制后即可修改；修改保存为新版本，进行中的任务继续用旧版本。',
  create: '新建流程',
  createTitle: '新建流程',
  copy: '复制',
  copyTitle: (name: string) => `复制「${name}」`,
  edit: '编辑',
  view: '查看',
  delete: '删除',
  deleteTitle: (name: string) => `删除流程「${name}」？`,
  deleteBody: '已经用这个流程的任务不受影响；流程不再出现在列表和主页中。',
  deleted: '流程已删除',
  key: '标识',
  keyHint: '小写字母开头，可用小写字母、数字与下划线',
  name: '名称',
  description: '说明',
  planning: '规划方式',
  deliverable: '产出',
  version: (v: number) => `第 ${v} 版`,
  created: '流程已创建',
  copyName: (name: string) => `${name}（副本）`,
  blankStepTitle: '步骤 1',
  blankStepInstructions: '说明这一步要做什么',
} as const;

export const WORKFLOW_EDITOR_COPY = {
  back: '← 流程',
  readonly: '内置流程只读。复制后可以修改。',
  basics: '基本信息',
  checkpoints: '默认检查点',
  checkpointsHint: '开始任务时可以逐个改变。',
  confirmPlan: '运行前确认计划',
  acceptEachNode: '每个步骤人工验收',
  defaultAcceptance: '步骤的默认检查',
  defaultAcceptanceHint: '每个步骤做完后运行；计划中单独设置了检查的步骤以自己的为准。',
  roles: '允许的角色',
  template: '步骤模板',
  planner: '规划',
  plannerRole: '规划者角色',
  guidance: '规划指引',
  guidanceHint: '这是给 AI 的指引：规划时照着它拆分步骤（内置流程的指引用英文写给模型）。',
  guidancePlaceholder: '告诉规划者这个流程怎么拆分步骤……（Markdown）',
  requiredSteps: '必经步骤',
  requiredHint: 'AI 的计划必须原样包含这些步骤；可以要求它们最先或最后执行。',
  requiredIncomplete: '必经步骤的标题与指令不能为空',
  plannedTitle: 'AI 规划的步骤',
  plannedHint: '运行时由规划者按需求拆分',
  noRequiredSelection:
    '点选一个必经步骤修改它。在「AI 规划的步骤」前后的连线上点 + 添加最先或最后执行的步骤；「添加步骤」添加不限位置的必经步骤。',
  builtinBadge: '内置 · 只读',
  nameRequired: '流程名称不能为空',
  unsaved: (n: number) => `${n} 处未保存修改`,
  addRequired: '添加必经步骤',
  removeRequired: '删除',
  stepKey: '标识',
  stepTitle: '标题',
  stepRole: '角色',
  stepInstructions: '指令',
  position: '位置',
  positionNone: '不限',
  positionFirst: '最先',
  positionLast: '最后',
  problems: '校验结果',
  noProblems: '定义可以保存。',
  save: '保存为新版本',
  saved: (v: number) => `已保存为第 ${v} 版`,
  versions: '版本',
  latest: '最新',
  notFound: '没有这个流程',
} as const;
