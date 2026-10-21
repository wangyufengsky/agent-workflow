import { AssistantConfirmationStatus, EntityKind, OperationRisk, type Platform } from '@aw/shared';
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
  close: '收起助手',
  untitled: '新对话',
  newConversation: '新对话',
  conversations: '对话',
  deleteConversation: '删除这个对话',
  deleteConfirm: '删除后消息、确认记录和助手生成的文件都会删除。',
  empty: '告诉助手你想做什么，比如「明天几号」「列出我的项目」「在订单服务里修一下登录报错」。',
  inputLabel: '发给助手的消息',
  inputPlaceholder: `问助手，或让它帮你做事…（${MOD_KEY}↵ 发送）`,
  send: '发送',
  stop: '停止',
  working: '助手正在处理…',
  toolLine: (tool: string) => `调用 ${tool}`,
  toolFailed: (tool: string) => `调用 ${tool} 失败`,
  attachment: '助手生成的文件',
  reveal: REVEAL[UI_PLATFORM],
  permissionTitle: '助手请求权限',
  permissionAllowOnce: '允许一次',
  permissionAlways: '总是允许',
  permissionReject: '拒绝',
  home: {
    label: '问助手',
    placeholder: '用一句话告诉助手你想做什么，回车发送',
    hint: '开发任务更推荐用下面的「开始任务」；零散的事交给助手。',
  },
} as const;

export const CONFIRMATION_COPY = {
  title: '需要你确认',
  confirm: '确认',
  confirmAlways: '确认并总是允许',
  cancel: '取消',
  input: '参数',
  running: '正在执行…',
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
    [EntityKind.KnowledgeConversation]: '知识库会话',
  } satisfies Record<EntityKind, string>,
  open: '打开',
  deleted: '已删除',
} as const;
