import { formatDateTime } from './common.ts';

export const ASSISTANT_CONTINUATION_COPY = {
  action: '续接对话',
  description: '从这次对话创建新会话，保留项目和交接内容。你也可以选择随新会话带上的附件。',
  attachmentChoices: '带到新会话的附件',
  noAttachments: '这次对话没有可带上的附件。',
  carriedAttachments: '从来源对话带上的附件',
  source: (title: string, date: number) => `续接自「${title}」 · ${formatDateTime(date)}`,
  sourceUnavailable: (date: number) => `来源对话已删除 · ${formatDateTime(date)}`,
  history: '查看续接前的消息',
  openSource: '打开来源对话',
  more: '加载更多旧消息',
  empty: '续接前还没有消息。',
  recentOnly: '交接内容只带了近期消息。',
  overflow: '这次对话已超出模型的上下文容量。',
  recoveredDraft: '已带入上次未能处理的消息，可编辑后发送。',
  user: '你',
  assistant: '助手',
} as const;
