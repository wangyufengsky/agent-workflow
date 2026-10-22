import {
  AssistantConfirmationStatus,
  AssistantToolName,
  EntityKind,
  InputRef,
  OperationRisk,
  type Platform,
} from '@aw/shared';
import { MOD_KEY, UI_PLATFORM } from '../app/platform.ts';

/** The system file manager differs by platform (17 §3.7). */
const REVEAL: Record<Platform, string> = {
  darwin: '在 Finder 中显示',
  win32: '在资源管理器中显示',
  linux: '在文件管理器中显示',
};

/** The app assistant (15 §6). */
export const ASSISTANT_COPY = {
  panel: '应用助手',
  open: `打开助手（${MOD_KEY}J）`,
  shortcut: `${MOD_KEY}J`,
  close: '收起助手',
  untitled: '新对话',
  newConversation: '新对话',
  conversations: '对话',
  switchConversation: '切换对话',
  deleteConversation: '删除这个对话',
  deleteConfirm: '删除后消息、确认记录和助手生成的文件都会删除。',
  greeting: '有什么可以帮你？',
  empty: '查信息、改设置、开任务、跨页面操作，用一句话告诉我就行。',
  suggestions: ['列出我的项目', '哪些事需要我处理', '明天几号', '最近有哪些任务失败了'],
  inputLabel: '发给助手的消息',
  inputPlaceholder: '问助手，或让它帮你做事…',
  sendHint: `${MOD_KEY}↵ 发送`,
  send: '发送',
  stop: '停止',
  thinking: '正在思考',
  toolFailed: '没有成功',
  toolStopped: '已中断',
  toolName: '工具',
  attachment: '助手生成的文件',
  reveal: REVEAL[UI_PLATFORM],
  permissionTitle: '助手请求权限',
  permissionAllowOnce: '允许一次',
  permissionAlways: '总是允许',
  permissionReject: '拒绝',
  home: {
    title: '零散的事，交给应用助手',
    body: '查信息、改设置、跨页面操作都可以直接说；开发任务请用上面的表单。',
    open: '问助手',
    suggestionsLabel: '试试问助手',
  },
} as const;

/** opencode's own tools (12 §2), keyed by the name opencode reports. */
const NATIVE_TOOL: Readonly<Record<string, string>> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  glob: '查找文件',
  grep: '搜索内容',
  list: '列出目录',
  bash: '运行命令',
  webfetch: '读取网页',
  websearch: '搜索网页',
  codesearch: '搜索代码',
  todowrite: '整理待办',
};

/** What each tool of the assistant does, as a verb phrase; operations use their titles (copy/operations.ts). */
export const TOOL_COPY = {
  app: {
    [AssistantToolName.GetCurrentTime]: '查看当前时间',
    [AssistantToolName.GetAppStatus]: '查看应用状态',
    [AssistantToolName.OpenPage]: '打开页面',
    [AssistantToolName.OpenForm]: '打开表单',
    [AssistantToolName.ListFiles]: '列出生成的文件',
    [AssistantToolName.RevealFile]: REVEAL[UI_PLATFORM],
  } satisfies Record<AssistantToolName, string>,
  /** opencode's own tools (12 §2); the user's own MCP servers show as `external`. */
  native: NATIVE_TOOL,
  external: '使用外部工具',
} as const;

export const CONFIRMATION_COPY = {
  title: '需要你确认',
  confirm: '确认',
  confirmAlways: '确认并总是允许',
  cancel: '取消',
  input: '参数',
  running: '正在执行…',
  yes: '是',
  no: '否',
  done: '已执行',
  failed: '执行失败',
  status: {
    [AssistantConfirmationStatus.Pending]: '等待确认',
    [AssistantConfirmationStatus.Confirmed]: '已确认',
    [AssistantConfirmationStatus.Cancelled]: '已取消',
  } satisfies Record<AssistantConfirmationStatus, string>,
  impact: {
    [OperationRisk.Read]: '',
    [OperationRisk.Write]: '会修改应用中的数据。可以选「总是允许」，以后同类操作不再询问（可在设置中撤销）。',
    [OperationRisk.Critical]: '影响较大或不可撤销，每次都需要你确认，不能设为总是允许。',
  } satisfies Record<OperationRisk, string>,
  diffStat: (files: number, additions: number, deletions: number) =>
    `将合并的改动：${files} 个文件，+${additions} −${deletions}`,
} as const;

export const ASSISTANT_SETTINGS_COPY = {
  title: '助手',
  alwaysAllow: '总是允许的操作',
  alwaysAllowHint: '助手调用这些操作时不再弹出确认卡片。合并、取消、删除等关键操作每次都需要确认，不会出现在这里。',
  none: '还没有总是允许的操作。在助手的确认卡片上选「确认并总是允许」即可加入。',
  revoke: '撤销',
} as const;

/** Navigation cards of the objects the assistant's calls produced (D66). */
export const ENTITY_COPY = {
  kind: {
    [EntityKind.Task]: '任务',
    [EntityKind.Project]: '项目',
    [EntityKind.Workflow]: '流程',
    [EntityKind.Role]: '角色',
    [EntityKind.DbConnection]: '数据库连接',
    [EntityKind.KnowledgeConversation]: '知识问答对话',
    [EntityKind.Batch]: '批量任务',
    [EntityKind.Deck]: 'PPT',
    [EntityKind.GitReview]: 'Git 审查',
    [EntityKind.Schedule]: '定时任务',
  } satisfies Record<EntityKind, string>,
  open: '打开',
  deleted: '已删除',
} as const;

/** Labels of input fields that name an object, by what they name (`OperationContract.refs`, 15 §4). */
export const INPUT_REF_LABEL = {
  ...ENTITY_COPY.kind,
  [InputRef.InboxItem]: '待处理条目',
  [InputRef.Node]: '步骤',
  [InputRef.Attempt]: 'AI 会话',
} satisfies Record<InputRef, string>;
