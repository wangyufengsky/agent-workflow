import { PermissionMode } from '@aw/shared';
export const PERMISSIONS_COPY = {
  conversation: '对话权限',
  task: '任务权限',
  question: '如何批准操作？',
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
