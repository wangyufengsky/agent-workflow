/** The assistant-first home page (28 §2, D111). */
export const HOME_COPY = {
  /** The wordmark of the home hero and the opening animation (28 §5): `lead` then the emphasised `emphasis`. */
  mark: { lead: 'Everything is a', emphasis: 'Workflow.' },
  tagline: '万事皆流程，执行由你掌控。',
  placeholder: '今天想让 AI 做什么？',
  conversationPlaceholder: '接着说，或选一个流程直接开始任务…',
  inputLabel: '告诉助手，或开始任务',
  startTask: (workflow: string) => `开始任务 · ${workflow}`,
  askInstead: '改为问助手',
  send: '发送',
  startNow: '直接开始',
  /** The workflows panel under「直接开始」(36 §5). */
  pickWorkflow: '选择流程开始任务',
  changeWorkflow: '换一个流程',
  customWorkflows: '自定义',
  moreWorkflows: (n: number) => `更多流程 ${n}`,
  moreWorkflowsLabel: '更多流程',
  more: '更多',
  tryAsking: '试试问',
  suggestions: ['列出我的项目', '哪些事需要我处理', '每周一早上 9 点给项目补单元测试', '把最近一次知识问答做成 PPT'],
  recent: '最近对话',
  allConversations: '全部对话',
  newConversation: '新对话',
  batch: '批量…',
  schedule: '定时…',
  rail: '工作概览',
  railHide: '收起工作概览',
  railShow: '展开工作概览',
  railEmpty: '没有进行中的工作。',
  batchProgress: (ended: number, total: number) => `${ended} / ${total} 已结束`,
} as const;

/** The opening animation (28 §5, D113); its wordmark and tagline are `HOME_COPY`'s. */
export const SPLASH_COPY = {
  title: 'Agent Workflow',
  failed: '后台服务没能启动',
  failedBody: '原因已写入日志。可以退出后重新打开应用。',
  quit: '退出',
} as const;
