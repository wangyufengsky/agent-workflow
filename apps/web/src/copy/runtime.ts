import { RuntimeStatus } from '@aw/shared';

export const RUNTIME_STATUS_LABEL: Record<RuntimeStatus, string> = {
  [RuntimeStatus.NotInstalled]: '未安装 opencode',
  [RuntimeStatus.VersionMismatch]: 'opencode 版本不符',
  [RuntimeStatus.Stopped]: 'opencode 未启动',
  [RuntimeStatus.Starting]: 'opencode 启动中',
  [RuntimeStatus.Ready]: 'opencode 运行中',
  [RuntimeStatus.Crashed]: 'opencode 已退出',
};
