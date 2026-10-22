import { McpToolName, RuntimeStatus, readOnlyStatementGroups } from '@aw/shared';
import { DATABASES_COPY } from './databases.ts';

export const RUNTIME_STATUS_LABEL: Record<RuntimeStatus, string> = {
  [RuntimeStatus.NotInstalled]: '未安装 opencode',
  [RuntimeStatus.VersionMismatch]: 'opencode 版本不符',
  [RuntimeStatus.Stopped]: 'opencode 未启动',
  [RuntimeStatus.Starting]: 'opencode 启动中',
  [RuntimeStatus.Ready]: 'opencode 运行中',
  [RuntimeStatus.Crashed]: 'opencode 已退出',
};

export const RUNTIME_COPY = {
  title: '运行环境',
  lede: '本应用托管的 opencode 服务。AI 会话都运行在它上面。',
  opencode: 'opencode',
  status: '状态',
  version: '版本',
  requiredVersion: '要求版本',
  path: '可执行文件',
  url: '服务地址',
  startedAt: '启动时间',
  restart: '重启 opencode',
  start: '启动 opencode',
  restartHint: '重启会中断正在进行的 AI 会话，之后可以重试。',
  startHint: 'opencode 没有在运行，启动后 AI 会话才能进行。',
  startingHint: '正在启动，稍候即可使用。',
  notHostable: '当前无法托管 opencode，请到环境检测页查看如何安装。',
  openOnboarding: '查看环境检测',
  models: '可用的模型',
  modelsCount: (n: number) => `${n} 个模型`,
  defaultChip: '默认',
  noModels: '还没有可用的模型。在终端登录一个模型提供方：',
  modelsPending: 'opencode 启动后显示。',
  logs: 'opencode 日志',
  logsTail: '显示行数',
  logsRefresh: '刷新',
  logsEmpty: 'opencode 还没有运行过，暂无日志。',
  logsFile: (file: string) => `最新的日志文件：${file}`,
} as const;

export const TOOLS_COPY = {
  title: 'MCP 工具',
  lede: 'AI 会话通过这些工具与本应用交互：读取上下文、提交计划与结果、提问、只读查询数据库。每种会话只能用允许的工具。',
  allowedKinds: '可用于',
  inputSchema: '输入参数（JSON Schema）',
  modelDescription: '给模型的说明',
  /** What each tool lets the AI do (12 §6), in the user's words. */
  description: {
    [McpToolName.GetTaskContext]: '读取任务的需求、当前步骤、检查方式、前面步骤的结果，以及用户的回答与反馈。',
    [McpToolName.GetNodeOutput]: '读取本任务中某个已完成步骤的完整产出：摘要、改动文件、注意事项与检查结果。',
    [McpToolName.GetTaskDiff]: '查看任务工作区相对基线的改动：文件列表，或某个文件的 diff。',
    [McpToolName.SubmitPlan]: '提交计划：步骤、角色、指令与依赖。计划不合规时返回问题，AI 修改后再提交。',
    [McpToolName.SubmitResult]: '步骤完成后提交结果；每次尝试只能提交一次，之后进入检查。',
    [McpToolName.SubmitReview]: '提交评审结论：通过，或列出问题及位置。',
    [McpToolName.AskUser]: '向你提问。阻塞的问题会让步骤停下来等你回答；不阻塞时 AI 按默认假设继续。',
    [McpToolName.ReportProgress]: '上报一句当前进展，显示在任务页上。',
    [McpToolName.DbListConnections]: '列出项目关联的数据库连接。',
    [McpToolName.DbDescribe]: '查看数据库的表结构。',
    // The allowed statements depend on the connection's database (24 §4).
    [McpToolName.DbQuery]: `只读查询数据库：每次一条只读语句（${readOnlyStatementGroups()
      .map((g) => `${g.types.map((t) => DATABASES_COPY.typeLabel[t]).join('、')} 允许 ${g.statements.join(' / ')}`)
      .join('；')}），限制行数与时间。`,
    [McpToolName.SubmitAnswer]:
      '知识问答：提交带引用的回答。引用的文件、行号或数据库连接不存在时返回问题，AI 修正后再提交。',
    [McpToolName.SubmitOutline]: 'PPT：提交大纲（每页的版式、标题与要点）以及 AI 对听众、时长的理解和假设。',
    [McpToolName.SubmitSlide]: 'PPT：按页码提交一页的内容与讲稿。字段超出版式的字数限制时返回问题，AI 精简后再提交。',
    [McpToolName.SubmitFindings]:
      'Git 工作台：提交审查结论与结构化问题（严重度、类别、文件、行、建议）。文件不在本次改动中或行号越界时返回问题，AI 修正后再提交。',
    [McpToolName.SubmitCommitMessage]: 'Git 工作台：提交草拟的提交信息（标题与正文），填进提交框由你修改。',
  } satisfies Record<McpToolName, string>,
} as const;
