import type { Platform } from '@aw/shared';

/** Install commands and examples differ by operating system (17 §3.7). */
type PerPlatform = Record<Platform, string>;

export const ONBOARDING_COPY = {
  title: '欢迎使用 Agent Workflow',
  lede: '开始之前，先确认这台电脑上的开发环境。',
  recheck: '重新检测',
  ready: '已就绪',
  notReady: '未就绪',
  git: {
    title: 'Git',
    installed: (version: string) => `已安装 ${version}`,
    missing: {
      darwin: '没有找到 Git。安装 Xcode 命令行工具即可获得：',
      win32: '没有找到 Git for Windows（本应用需要其中的 Git Bash）。在终端安装：',
      linux: '没有找到 Git。在终端安装：',
    } satisfies PerPlatform,
    fix: {
      darwin: 'xcode-select --install',
      win32: 'winget install --id Git.Git -e',
      linux: 'sudo apt install git',
    } satisfies PerPlatform,
  },
  opencode: {
    title: 'opencode 1.19.0',
    ok: (version: string, path: string) => `已安装 ${version}（${path}）`,
    missing: '没有找到 opencode。在终端安装指定版本：',
    mismatch: (version: string) => `已安装的版本是 ${version}，本应用需要 1.19.0。在终端切换版本：`,
    fix: 'npm install -g opencode-ai@1.19.0',
    choosePath: '已安装在其他位置？填写 opencode 可执行文件的路径：',
    pathPlaceholder: {
      darwin: '/usr/local/bin/opencode',
      win32: 'C:\\Users\\你\\AppData\\Roaming\\npm\\opencode.cmd',
      linux: '/home/你/.opencode/bin/opencode',
    } satisfies PerPlatform,
    usePath: '使用此路径',
  },
  models: {
    title: '可用的模型',
    pendingBadge: '启动后检测',
    pending: '启动 opencode 后检测；如果还没登录模型提供方，请在终端运行：',
    available: (n: number) => `${n} 个模型可用`,
    none: '还没有可用的模型。在终端登录一个模型提供方：',
    fix: 'opencode auth login',
  },
  credentials: {
    title: '凭据存储',
    available: '可以安全保存托管平台令牌与数据库密码。',
    unavailableBadge: '不可用',
    unavailable: '系统没有可用的密钥服务，暂时不能保存托管平台令牌与数据库密码（其他功能不受影响）。安装后重启应用：',
    fix: {
      darwin: null,
      win32: null,
      linux: 'sudo apt install gnome-keyring',
    } satisfies Record<Platform, string | null>,
  },
  copyCommand: '复制命令',
  copied: '已复制',
  addFirstProject: '添加第一个项目',
  addFirstProjectHint: '选择一个本地 Git 仓库的根目录。AI 会在独立的分支和工作区里改代码，不会碰你当前的工作区。',
  envNotReady: '请先解决上面未就绪的项目。',
} as const;
