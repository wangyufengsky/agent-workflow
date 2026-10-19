import { RuntimeStatus } from '@aw/shared';

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
  notHostable: '当前无法托管 opencode，请到首次启动页查看如何安装。',
  openOnboarding: '查看环境检测',
  models: '可用的模型',
  modelsCount: (n: number) => `${n} 个模型`,
  defaultModel: (model: string) => `默认模型：${model}`,
  noModels: '还没有可用的模型。在终端登录一个模型提供方：',
  modelsPending: 'opencode 启动后显示。',
} as const;
