import { PermissionMode } from '@aw/shared';
export const PERMISSIONS_COPY = {
  conversation: '对话权限',
  task: '任务权限',
  question: '如何批准操作？',
  design: {
    label: '设计权限',
    fullName: '自动批准只读',
    hint: '适用于本设计之后的权限请求和章节。已出现的审批卡仍需处理。',
    [PermissionMode.Ask]: '需要额外权限时，由你逐次确认。',
    [PermissionMode.Assisted]: '审批员核对扫描范围内的只读命令，拿不准时询问你。',
    [PermissionMode.Full]: '自动允许可核验的项目只读命令。超出扫描范围或无法核验的操作仍需确认。',
  },
  knowledge: {
    label: '问答权限',
    [PermissionMode.Ask]: '超出只读命令白名单的操作由你审批。',
    [PermissionMode.Assisted]: '审批员核对操作，符合只读规则时放行，拿不准时询问你。',
    [PermissionMode.Full]: '自动允许符合规则的只读命令，其他命令仍会询问。资料范围和网络检索设置继续生效。',
  },
  [PermissionMode.Ask]: { name: '始终询问', description: '沿用当前权限规则，需要批准的操作交给你。' },
  [PermissionMode.Assisted]: {
    name: '帮我批准',
    description: '审批员核对本次操作，低风险且符合要求时放行，有风险或拿不准时询问你。',
  },
  [PermissionMode.Full]: {
    name: '完全访问',
    description: '执行角色可使用网络、访问工作区外文件和运行本机命令，命令可以直接修改 Git。',
  },
} as const;
