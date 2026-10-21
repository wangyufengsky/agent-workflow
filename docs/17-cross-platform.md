# 17 · Windows 与 Linux 支持（v1.1）

v1.0 只验收了 macOS arm64（D13），代码按跨平台抽象编写。本文说明 v1.1 支持 Windows 与 Linux 时各模块的平台差异和处理方式；任务拆分见 [05 §v1.1 跨平台](05-dev-plan.md#v11--windows-与-linux)，决策见 02 的 D66–D71。

## 1. 目标平台

| 平台 | 架构 | 级别 | 安装包 |
| --- | --- | --- | --- |
| macOS 14+ | arm64 | 支持（v1.0 已验收） | dmg（未签名） |
| Windows 10 / 11 | x64 | 支持 | NSIS 安装程序 `.exe`（未签名，可选安装目录） |
| Ubuntu 22.04 / 24.04 | x64 | 支持 | `.deb` 与 `.AppImage` |
| 其他 x64 Linux 发行版（Debian、Fedora、Arch 等） | x64 | 尽力支持：用 AppImage，不单独测试 | `.AppImage` |

不支持：Windows / Linux 的 arm64、32 位系统、WSL 内运行桌面应用（WSL 中的仓库可以通过 `\\wsl$` 路径添加，但不测试）。

**前置软件**（引导页逐项检测）：

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Git | Xcode 命令行工具或 Homebrew | **Git for Windows**（自带 Git Bash，见 §3.3） | 发行版的 `git` 包 |
| opencode 1.19.0 | `npm install -g opencode-ai@1.19.0` 或官方安装脚本 | `npm install -g opencode-ai@1.19.0` | 同 macOS |
| 凭据存储 | 钥匙串（总可用） | DPAPI（总可用） | Secret Service（GNOME Keyring 等，`libsecret`）或 KWallet；没有时不能保存令牌与密码（§3.6） |

## 2. 原则

1. **平台差异只在三处处理**，业务代码里不写 `process.platform`：
   - 后端 `packages/server/src/core/platform.ts`：环境变量（PATH、主目录）、可执行文件查找、命令行 shell、终止进程树、git 的平台参数、git 输出路径的规范化。
   - 桌面 main `apps/desktop/src/main/`：safeStorage 的可用性判断（只有 Linux 有差异）、菜单与关于面板。
   - 前端 `apps/web/src/app/platform.ts`：按 `EnvironmentDTO.platform` 选安装命令文案；快捷键显示（⌘ / Ctrl）。
2. **路径只经 `node:path`**，不手写分隔符；来自 git 的路径先规范化再与本机路径比较（§3.4）。
3. **同一套行为，不按平台降级**。做不到同样安全的地方（Windows 的 shell、Linux 的凭据）明确要求前置条件或明确失败，不退回到更弱的实现。

## 3. 各模块的平台差异

### 3.1 数据目录

Electron `app.getPath('userData')`，目录名为产品名：

| 平台 | 位置 |
| --- | --- |
| macOS | `~/Library/Application Support/Agent Workflow/` |
| Windows | `%APPDATA%\Agent Workflow\`（即 `C:\Users\<用户>\AppData\Roaming\Agent Workflow\`） |
| Linux | `$XDG_CONFIG_HOME/Agent Workflow/`，默认 `~/.config/Agent Workflow/` |

目录结构与 03 §7 相同。默认 worktree 根目录在数据目录下；Windows 上它比仓库本身的路径长约 50 个字符，长路径见 §3.4。

### 3.2 opencode 二进制查找（`opencode.binary.ts` + `platform.ts`）

查找顺序不变：设置项 `opencode.binaryPath` → PATH → 安装脚本的默认目录。平台差异：

| | 文件名 | 安装脚本目录 | 主目录来源 |
| --- | --- | --- | --- |
| macOS / Linux | `opencode` | `~/.opencode/bin/opencode` | `HOME` |
| Windows | `opencode.exe`，其次 `opencode.cmd`（npm 全局安装生成的启动脚本） | `%USERPROFILE%\.opencode\bin\opencode.exe` | `USERPROFILE` |

- Windows 的环境变量名不区分大小写（系统里常见 `Path`），而后端把环境复制成普通对象传给子进程，`env.PATH` 可能读不到。`platform.ts` 的 `envValue(env, name)` 在 Windows 上按不区分大小写读取，这是读 PATH / 主目录的唯一入口。
- Node 不允许不经 shell 直接启动 `.cmd`（CVE-2024-27980 之后会报 `EINVAL`）。`platform.ts` 的 `commandFor(file, args)` 对 `.cmd` 改为 `cmd.exe /d /s /c "<文件> <参数>"`（参数都是本应用写死的字面量，不含 cmd 元字符）；opencode 的检测（`--version`）与托管（`serve`）都经它启动。
- Windows 上「可执行」只看文件存在（`X_OK` 等同 `F_OK`），扩展名决定能否运行，所以只认 `.exe` 与 `.cmd`。

### 3.3 opencode 在 Windows 上用的 shell 与 bash 权限规则

**问题。** opencode 1.19.0 的 shell 工具（`packages/core/src/shell.ts`，已从源码确认）在 Windows 上没有配置 `shell` 时按 `pwsh` → `powershell` → Git Bash → `cmd.exe` 的顺序选择，Windows 总有 `powershell.exe`，所以默认是 **PowerShell**。权限匹配时 opencode 用对应语言的 tree-sitter 语法拆出子命令再按我们的通配规则匹配：PowerShell 语法下，`cat` / `ls` 是 `Get-Content` / `Get-ChildItem` 的别名，`$( … )` 子表达式、`;`、管道到 `ForEach-Object` 的脚本块等写法与 bash 不同，D51 / D61 / D63 / D64 的只读白名单和「逃逸写法」规则是按 bash 语义推敲的，在 PowerShell 下不再成立（例如 `echo $(Remove-Item x)` 的整体文本以 `echo` 开头）。

**对策（D67）。** Windows 上要求 Git for Windows（自带 Git Bash），并在注入的 opencode 配置中设置 `shell` 为 Git Bash 的绝对路径。opencode 对 bash 用 bash 语法解析、以 `bash -l -c` 运行，规则与 macOS / Linux 的语义一致，规则本身不分平台。

- Git Bash 的位置由 `git --exec-path`（如 `C:/Program Files/Git/mingw64/libexec/git-core`）上溯三级得到 Git 安装根目录，取 `<根目录>\bin\bash.exe`。用 `--exec-path` 而不是 PATH 中 `git.exe` 的位置，是因为 scoop 等安装方式在 PATH 里放的是转发程序。
- 找不到 Git Bash（例如只有 MinGit）时：引导页 Git 一项显示「未就绪」并说明需要 Git for Windows；托管 opencode 不启动（启动时生成配置失败 → 运行时 `crashed`，日志写明原因）。不退回到 PowerShell。
- 只注入 `shell`，不改 opencode 的其他行为；用户自己的 opencode 配置里的 `shell` 在 Windows 上被覆盖（注入配置优先，S3）。
- macOS / Linux 不注入，opencode 用用户的 `$SHELL`（login shell 带来用户的 PATH，如 nvm）。用户若把 opencode 的 `shell` 配成 PowerShell 等非 POSIX shell，规则同样不成立——这是 v1.0 起就有的前提，记在「发现但未处理」中（§7）。

### 3.4 Git

| 差异 | 处理 |
| --- | --- |
| git 输出的路径用 `/`（`git rev-parse --show-toplevel`、`git worktree list` 输出 `C:/Users/...`），本机路径用 `\` | git 模块读取路径的两个入口（`readRepoRoot`、`listWorktrees`）经 `platform.fromGitPath()` 规范化为本机形式（Windows 上 `path.win32.normalize`，其他平台原样），之后与 `realpath` 得到的路径直接比较。传给 git 的路径用本机形式，git 接受 |
| 路径大小写与 8.3 短名（`C:\Users\RUNNER~1`） | 存库的路径都来自 `realpath`（Windows 上返回长名与磁盘上的真实大小写）或 git 的输出；两者对同一目录一致。不做不区分大小写的比较 |
| 长路径（> 260 字符） | Node 的 fs 自动处理；Git for Windows 需要 `core.longpaths=true`。`runGit` 在 Windows 上固定加 `-c core.longpaths=true`（`platform.GIT_PLATFORM_ARGS`），不改用户的全局配置。Windows 本身的长路径开关（组策略 `LongPathsEnabled`）影响用户的构建工具，README 中说明 |
| `core.autocrlf` | 不覆盖用户配置：任务 worktree 与用户主工作区的检出方式一致，提交内容由 git 规范化。本仓库自身加 `.gitattributes`（`* text=auto eol=lf`），否则 Windows 上 Biome 格式检查与状态机文档校验会因 CRLF 失败 |
| `LC_ALL=C` | Git for Windows 用 gettext，同样遵守 `LC_ALL`，保留 |
| worktree 删除时文件被占用 | 根因是仍在运行的进程（opencode 的 bash 子进程、检查命令启动的 node / java）持有工作区里的文件或把它当作当前目录。处理根因：中止与超时时终止整个进程树（§3.5）。删除仍失败时照常进入 `remove_failed`，Git 管理台可再次清理，不加重试 |
| `diff --no-index /dev/null` | git 在 Windows 上也把 `/dev/null` 识别为空文件，不变 |

### 3.5 子进程

| 子进程 | macOS / Linux | Windows |
| --- | --- | --- |
| `opencode serve` | `SIGTERM`，opencode 自己结束子进程 | 没有信号，`TerminateProcess` 只结束 opencode 本身，bash 子进程与语言服务会留下。用 `taskkill /pid <pid> /T /F` 结束进程树（`platform.killProcessTree`） |
| 检查命令（`acceptance.runCommand`） | `/bin/sh -c`；超时 / 中止时 `SIGTERM` | Git Bash `-c`（与 opencode 同一个 shell，D68）；超时 / 中止时 `taskkill /T /F` |
| git | 正常退出，不需要终止 | 同左 |

- 检查命令在所有平台都由 POSIX shell 执行，`mvn -q test && …`、`./gradlew test` 的写法与推断出的检查命令（`projects.inference.ts`）在三个平台一致，不按平台推断不同命令。
- 检查命令的超时与中止不再交给 execa 的 `timeout` / `cancelSignal`（它们只结束 shell 本身），改为注入时钟计时并调用 `killProcessTree`。
- `taskkill` 在 `C:\Windows\System32` 中，从 `SystemRoot` 定位，不依赖 PATH。

### 3.6 凭据（safeStorage）

| 平台 | 后端 | 可用性 |
| --- | --- | --- |
| macOS | 钥匙串 | 总可用 |
| Windows | DPAPI（按 Windows 用户加密） | 总可用 |
| Linux | Secret Service（`gnome_libsecret`）或 KWallet（`kwallet` / `kwallet5` / `kwallet6`） | 取决于桌面环境 |

Linux 上没有识别到密钥服务时，Chromium 退回 `basic_text`：用写死在源码中的密钥「加密」，等同明文，而 `safeStorage.isEncryptionAvailable()` 仍返回 `true`。因此 main 判断可用性时另外要求 `safeStorage.getSelectedStorageBackend()` 不是 `basic_text` / `unknown`（D69）。不可用时：

- 加解密请求返回失败，后端抛 `CREDENTIAL_UNAVAILABLE`（已有行为），绑定令牌、保存数据库密码的表单显示该错误的文案；不退回明文。
- 引导页增加「凭据存储」一项（`EnvironmentDTO.credentials`，后端经 credential port 新增的 `status` 请求询问 main）：不可用时为警告（不阻止「就绪」，只有托管平台令牌与数据库密码需要它），说明安装 `gnome-keyring`（或使用 KDE 的 KWallet）后重启应用。
- 开发模式（`pnpm dev:server`、浏览器 E2E）的明文适配器报告可用，与现状一致。

### 3.7 引导页与界面文案

- `EnvironmentDTO` 增加 `platform`（`darwin` / `win32` / `linux`，后端的 `process.platform`，D70）。前端只用它选择文案，不自己猜测操作系统。
- 安装命令按平台：

| | macOS | Windows | Linux（Ubuntu） |
| --- | --- | --- | --- |
| Git | `xcode-select --install` | `winget install --id Git.Git -e` | `sudo apt install git` |
| opencode | `npm install -g opencode-ai@1.19.0` | 同左 | 同左 |
| 登录模型 | `opencode auth login` | 同左 | 同左 |
| 凭据存储（不可用时） | — | — | `sudo apt install gnome-keyring` |

- opencode 路径输入框的占位示例按平台（`/usr/local/bin/opencode`、`C:\Users\你\AppData\Roaming\npm\opencode.cmd`、`/home/你/.opencode/bin/opencode`）；设置页 opencode 路径的说明同样按平台。
- 快捷键：处理时已同时接受 `metaKey` 与 `ctrlKey`；显示时 macOS 用 `⌘`，其他平台用 `Ctrl`（如 `Ctrl+K`、`Ctrl+↵`）。显示由前端 `platform.ts` 的 `modKey` 决定，它读 `navigator.userAgent`（快捷键属于运行界面的机器；浏览器 E2E 中前后端在同一台机器）。
- 关于面板：`app.setAboutPanelOptions` 在 macOS 与 Linux 有效；Windows 没有系统关于面板，设置页的「关于」已覆盖。

### 3.8 打包（electron-builder 26，D71）

| 平台 | 目标 | 说明 |
| --- | --- | --- |
| macOS | dmg arm64 | 不变 |
| Windows | NSIS x64，`oneClick: false`、可改安装目录、按用户安装 | 未签名：SmartScreen 提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」 |
| Linux | AppImage x64、deb x64 | 未签名。deb 的维护者字段取 `linux.maintainer`；可执行文件名 `agent-workflow`；deb 依赖 `libsecret-1-0`（凭据存储，§3.6） |

- 图标：`build/icon.svg` 渲染出 `build/icon.png`（1024 px），Windows（转 ico）与 Linux 使用；macOS 仍用 `icon.icns`。
- `pnpm dist` 构建当前平台的安装包（`electron-builder` 不带平台参数，按各平台的 `target` 配置），CI 在各自的 runner 上运行。
- Linux 的已知限制（README 说明，**需要用户在真机确认**）：
  - Ubuntu 24.04 默认用 AppArmor 限制非特权用户命名空间，Chromium 沙箱无法启动 AppImage（报 `The SUID sandbox helper binary was found, but is not configured correctly`）。deb 安装会带上 SUID 的 `chrome-sandbox`，不受影响；AppImage 需要按 README 放行或使用 deb。不以 `--no-sandbox` 作为默认。
  - AppImage 需要 FUSE 2（Ubuntu 22.04 默认有，24.04 需 `sudo apt install libfuse2t64`）。

### 3.9 其他检查过、无需改动的点

- 端口与地址：都绑定 `127.0.0.1`；Windows 防火墙对环回地址不弹窗。
- SQLite（`node:sqlite`）、JSONL 日志、迁移文件：只用 `node:path` 拼接，跨平台。
- opencode 插件文件以 `pathToFileURL` 传给 opencode，Windows 上为 `file:///C:/...`，正确。
- 数据库 MySQL 驱动、托管平台 HTTP：与平台无关。
- 后端脚本（`scripts/*.mjs|ts`）只用 `node:path`；`scripts/check-prod-bundle.mjs` 读取构建产物，跨平台。

## 4. 测试与 CI

### 4.1 GitHub Actions（`.github/workflows/ci.yml`）

矩阵 `macos-latest`、`ubuntu-latest`、`windows-latest`，每个平台：

1. `pnpm install --frozen-lockfile`（Node 24、pnpm 10.28）；Playwright 只装 Chromium。
2. `pnpm verify` 的各步骤：`check`、`test`、`test:int`、`build`。
3. `pnpm e2e`（浏览器 E2E，FakeOpencode）。
4. Electron 启动冒烟 `pnpm e2e:smoke`（`launch.electron.spec.ts`：打包前的构建产物启动、后端握手、显示引导页、四项检测有结果；Linux 下用 `xvfb-run`）。
5. ubuntu 与 windows 上 `pnpm dist`，安装包（`release/*.exe`、`*.AppImage`、`*.deb`）作为 artifact 上传。

**数据库集成测试只在 ubuntu 上运行。** `databases.int.test.ts` 需要 Docker 中的 Linux 容器 `mysql:8.4`：GitHub 的 Windows runner 的 Docker 只能运行 Windows 容器，macOS runner 没有 Docker。工作流在这两个平台对 `test:int` 显式加 `--exclude '**/databases.int.test.ts'` 并在步骤名与注释中写明原因；代码中不按平台跳过（缺 Docker 时测试照常失败）。该测试与平台无关（只经 TCP 访问 MySQL），在 ubuntu 上运行即覆盖。

**不进 CI**：`test:oc`、`test:live`、J10（`journey.electron.spec.ts`）需要真实 opencode、登录的模型与网络，仍在本机运行。

### 4.2 测试代码中的平台差异

只在测试辅助函数中处理，测试用例本身不写平台判断：

- `test/helpers/executables.ts`：`writeFakeExecutable(dir, name, script)` 在 Windows 上写 `<name>.cmd`，其他平台写可执行的 sh 脚本；`gitOnlyPath()` 构造只含 git 的 PATH（POSIX 上软链接 git，Windows 上用 git 自己的目录，因为 Git for Windows 的 `git.exe` 依赖安装目录的相对位置）。
- 浏览器 E2E 的假 opencode：`e2e/fixtures/bin/` 同时有 `opencode`（sh）与 `opencode.cmd`；PATH 用 `path.delimiter` 拼接，主目录同时设 `HOME` 与 `USERPROFILE`。

## 5. 验收

| 项 | 方式 | 由谁 |
| --- | --- | --- |
| 三平台 `pnpm verify`（Windows / macOS 除数据库集成测试）、浏览器 E2E、Electron 启动冒烟 | CI 全绿 | CI |
| Windows NSIS 与 Linux AppImage / deb 能打出来 | CI artifact | CI |
| 本机 macOS：`pnpm verify`、`pnpm e2e`、`pnpm test:oc` | 本机运行 | 开发者 |
| **Windows 真机**：安装 NSIS 包（SmartScreen 放行）→ 引导页三项检测（Git for Windows、opencode 1.19.0、模型）→ 添加项目 → 跑通一个「修 Bug」任务 → 合并；任务中模型执行 bash 命令时只读规则生效（规划阶段不弹权限请求）；取消运行中的任务后 worktree 能被清理 | 手动 | **需要用户完成** |
| **Linux 真机（Ubuntu 22.04 / 24.04 桌面）**：安装 deb 与运行 AppImage（24.04 的 AppArmor 限制）→ 引导页三项检测与「凭据存储」→ 绑定托管平台令牌（GNOME Keyring 存在时成功；无密钥服务时显示 `CREDENTIAL_UNAVAILABLE`）→ 跑通一个任务 | 手动 | **需要用户完成** |
| 真实 opencode 在 Windows / Linux 上的 `test:oc`、`test:live`、J10 | 在对应机器上运行 | **需要用户完成**（可选） |

## 6. 不做

- 代码签名（Windows Authenticode、Linux 仓库签名）：没有证书，与 macOS 一致。
- 自动更新、Snap / Flatpak / rpm、Windows MSI 与 Microsoft Store。
- 在 Windows 上用 PowerShell 或 cmd 作为 AI 的 shell（§3.3）。

## 7. 发现但未处理

- macOS / Linux 上若用户在自己的 opencode 配置中把 `shell` 设为 PowerShell / nushell，只读规则同样不按 bash 语义匹配（v1.0 起的前提）。可选做法是三平台都注入 POSIX shell，但会失去 login shell 带来的 PATH，需要单独决定。
- POSIX 上检查命令超时只结束 `/bin/sh`（行为与 v1.0 相同）；shell 不是直接 `exec` 命令时（如 `a && b`）子进程会留下。Windows 已按进程树结束。
