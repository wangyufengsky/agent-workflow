# 17 · Windows 与 Linux 支持（v1.1）

v1.0 只验收了 macOS arm64（D13），代码按跨平台抽象编写。本文说明 v1.1 支持 Windows 与 Linux 时各模块的平台差异和处理方式；任务拆分见 [05 §v1.1 跨平台](05-dev-plan.md#v11--windows-与-linux)，决策见 02 的 D71–D76、D81、D82、D117。

## 1. 目标平台

| 平台 | 架构 | 级别 | 安装包 |
| --- | --- | --- | --- |
| macOS 14+ | arm64 | 支持（v1.0 已验收） | dmg（未签名） |
| Windows 10 / 11 | x64 | **暂缓**（D160）：代码与打包配置保留，不进 CI、不做真机验证 | NSIS 安装程序 `.exe`（未签名，可选安装目录） |
| Ubuntu 22.04 / 24.04 | x64、arm64（D160） | 支持 | `.deb` 与 `.AppImage` |
| 其他 Linux 发行版（Debian、Fedora、Arch 等） | x64、arm64 | 尽力支持：用 AppImage，不单独测试 | `.AppImage` |

不支持：Windows arm64、32 位系统、WSL 内运行桌面应用（WSL 中的仓库可以通过 `\\wsl$` 路径添加，但不测试）。

**前置软件**（引导页逐项检测）：

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Git | Xcode 命令行工具或 Homebrew | **Git for Windows**（自带 Git Bash，见 §3.3） | 发行版的 `git` 包 |
| opencode 1.18.0 – 1.90.x（推荐 1.19.0，D156） | `npm install -g opencode-ai@1.19.0` 或官方安装脚本 | `npm install -g opencode-ai@1.19.0` | 同 macOS |
| 凭据存储 | 钥匙串（总可用） | DPAPI（总可用） | Secret Service（GNOME Keyring 等，`libsecret`）或 KWallet；没有时不能保存令牌与密码（§3.6） |

## 2. 原则

1. **平台差异只在三处处理**，业务代码里不写 `process.platform`：
   - 后端 `packages/server/src/core/platform.ts`：环境变量（PATH、主目录）、可执行文件查找、命令行 shell、终止进程树、git 的平台参数、git 输出路径的规范化。
   - 桌面 main `apps/desktop/src/main/`：safeStorage 的可用性判断（只有 Linux 有差异）、菜单与关于面板、交给后端的 PATH（macOS / Linux 取自登录 shell，§3.12）。
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
- Node 不允许不经 shell 直接启动 `.cmd`（CVE-2024-27980 之后会报 `EINVAL`）。execa 10 在 Windows 上自己按 `PATHEXT` 解析命令，`.cmd` 经 `cmd.exe` 运行并转义参数，所以 opencode 的检测（`--version`）与托管（`serve`）直接用找到的路径。
- 反过来，execa 解析不到的命令也会交给 `cmd.exe`，结果是退出码 1 与「不是内部或外部命令」而不是 `ENOENT`。所以 `runGit` 先用 `platform.findExecutable('git', PATH)` 定位 git，找不到即 `GIT_NOT_INSTALLED`，不靠启动失败判断。
- Windows 上「可执行」只看文件存在（`X_OK` 等同 `F_OK`），扩展名决定能否运行，所以只认 `.exe` 与 `.cmd`。

### 3.3 opencode 在 Windows 上用的 shell 与 bash 权限规则

**问题。** opencode 1.19.0 的 shell 工具（`packages/core/src/shell.ts`，已从源码确认）在 Windows 上没有配置 `shell` 时按 `pwsh` → `powershell` → Git Bash → `cmd.exe` 的顺序选择，Windows 总有 `powershell.exe`，所以默认是 **PowerShell**。权限匹配时 opencode 用对应语言的 tree-sitter 语法拆出子命令再按我们的通配规则匹配：PowerShell 语法下，`cat` / `ls` 是 `Get-Content` / `Get-ChildItem` 的别名，`$( … )` 子表达式、`;`、管道到 `ForEach-Object` 的脚本块等写法与 bash 不同，D51 / D61 / D63 / D64 的只读白名单和「逃逸写法」规则是按 bash 语义推敲的，在 PowerShell 下不再成立（例如 `echo $(Remove-Item x)` 的整体文本以 `echo` 开头）。

**对策（D72）。** Windows 上要求 Git for Windows（自带 Git Bash），并在注入的 opencode 配置中设置 `shell` 为 Git Bash 的绝对路径。opencode 对 bash 用 bash 语法解析、以 `bash -l -c` 运行，规则与 macOS / Linux 的语义一致，规则本身不分平台。

- Git Bash 的位置由 `git --exec-path`（如 `C:/Program Files/Git/mingw64/libexec/git-core`）上溯三级得到 Git 安装根目录，取 `<根目录>\bin\bash.exe`。用 `--exec-path` 而不是 PATH 中 `git.exe` 的位置，是因为 scoop 等安装方式在 PATH 里放的是转发程序。
- 找不到 Git Bash（例如只有 MinGit）时：引导页 Git 一项显示「未就绪」并说明需要 Git for Windows；托管 opencode 不启动（启动时生成配置失败 → 运行时 `crashed`，日志写明原因）。不退回到 PowerShell。装好后在引导页点「重新检测」即可：重新检测会再次启动 `crashed` 的运行时，不必重启应用。
- 只注入 `shell`，不改 opencode 的其他行为；用户自己的 opencode 配置里的 `shell` 在 Windows 上被覆盖（注入配置优先，S3）。
- macOS / Linux 不注入，opencode 用用户的 `$SHELL`。它以 `-l` 运行，只读 `.zprofile` 等登录脚本，写在 `.zshrc` 里的 PATH（Homebrew、nvm、sdkman 常见）要靠后端本身的 PATH 带进来（§3.12）。用户若把 opencode 的 `shell` 配成 PowerShell 等非 POSIX shell，规则同样不成立——这是 v1.0 起就有的前提，记在「发现但未处理」中（§7）。

### 3.4 Git

| 差异 | 处理 |
| --- | --- |
| git 输出的路径用 `/`（`git rev-parse --show-toplevel`、`git worktree list` 输出 `C:/Users/...`），本机路径用 `\` | git 模块读取路径的两个入口（`readRepoRoot`、`listWorktrees`）经 `platform.fromGitPath()` 规范化为本机形式（Windows 上 `path.win32.normalize`，其他平台原样），之后与 `realpath` 得到的路径直接比较。传给 git 的路径用本机形式，git 接受 |
| 路径大小写与 8.3 短名（`C:\Users\RUNNER~1`） | 存库的路径都来自 `realpath`（Windows 上返回长名与磁盘上的真实大小写）或 git 的输出；两者对同一目录一致。不做不区分大小写的比较 |
| 长路径（> 260 字符） | Node 的 fs 自动处理；Git for Windows 需要 `core.longpaths=true`。`runGit` 在 Windows 上固定加 `-c core.longpaths=true`（`platform.GIT_PLATFORM_ARGS`），不改用户的全局配置。Windows 本身的长路径开关（组策略 `LongPathsEnabled`）影响用户的构建工具，README 中说明 |
| `core.autocrlf` | 不覆盖用户配置：任务 worktree 与用户主工作区的检出方式一致，提交内容由 git 规范化。本仓库自身加 `.gitattributes`（`* text=auto eol=lf`），否则 Windows 上 Biome 格式检查与状态机文档校验会因 CRLF 失败 |
| `LC_ALL=C` | Git for Windows 用 gettext，同样遵守 `LC_ALL`，保留 |
| worktree 删除时文件被占用 | 根因是仍在运行的进程（opencode 的 bash 子进程、检查命令启动的 node / java）持有工作区里的文件或把它当作当前目录。处理根因：中止与超时时终止整个进程树（§3.5）。删除仍失败时照常进入 `remove_failed`，Git 工作台可再次清理，不加重试 |
| `diff --no-index /dev/null` | git 在 Windows 上也把 `/dev/null` 识别为空文件，不变 |

### 3.5 子进程

| 子进程 | macOS / Linux | Windows |
| --- | --- | --- |
| `opencode serve` | 自成进程组（`detached`），停止时向进程组发 `SIGTERM` | 没有信号，`TerminateProcess` 只结束 opencode 本身，bash 子进程与语言服务会留下。用 `taskkill /pid <pid> /T /F` 结束进程树 |
| 检查命令（`acceptance.runCommand`） | `/bin/sh -c`，自成进程组；超时 / 中止时向进程组发 `SIGTERM` | Git Bash `-c`（与 opencode 同一个 shell，D73）；超时 / 中止时 `taskkill /T /F` |
| 页面预览的开发服务器（v1.3，`previews.process.ts`，29 §4） | 与检查命令同一个 POSIX shell、`killDescendants`；停止、空闲、worktree 删除前与应用退出时结束整棵进程树（macOS 上实测没有残留，29 §12 V5） | 同检查命令（Git Bash，`taskkill /T`）；**未在 Windows 上验证**（CI 停跑）。worktree 删除前先结束它，否则 Windows 上文件被占用（`worktrees.onBeforeRemove`） |
| git | 正常退出，不需要终止 | 同左 |

两者都用 execa 的 `killDescendants` 启动（POSIX 上自成进程组，Windows 上停止时运行 `taskkill /T`），`child.kill()` 即结束整棵进程树。只结束 shell 本身时，它启动的命令（`a && b` 中的 `b`、后台的测试进程）继续运行并占着输出管道，execa 的结果要等它们结束才返回。

**应用退出。** 结束 utilityProcess（Windows 上即 `TerminateProcess`）不会运行后端的清理，opencode 会留下。main 在 `will-quit`、窗口已关闭后，先等待 `session.defaultSession.closeAllConnections()` 结束本应用默认会话的请求与预连接，再向后端发 `backend.shutdown`（`shared/contracts/backend-port.ts`）。Chromium 预连接可能尚未发送 HTTP 请求；如果仍由 NetworkService 持有，后端 HTTP 关闭会等待它，而 main 又在等待后端，形成退出等待环。该步骤会取消默认会话中尚未完成的网络请求；不关闭网站与预览使用的其他会话分区。后端随后按原顺序关闭 HTTP 服务并退出，main 等它退出，再关闭剩下的浏览器标签页（后端停止时先关闭自己的，29 §5.1）后退出。关闭时先（`preClose`，API 与数据库仍可用）把活动尝试按 `runtime_lost` 记为 `interrupted`，再结束 opencode 进程树（09 §9）：结束进程时还在进行的请求失败，不会再把尝试记成 `failed`；`pnpm dev:server` 下 Ctrl+C（`SIGINT`）走同一路径。

- 检查命令在所有平台都由 POSIX shell 执行，`mvn -q test && …`、`./gradlew test` 的写法与推断出的检查命令（`projects.inference.ts`）在三个平台一致，不按平台推断不同命令。
- 检查命令的超时改为注入时钟计时（原来是 execa 的 `timeout`），超时与中止都调用 `child.kill()`。

### 3.6 凭据（safeStorage）

| 平台 | 后端 | 可用性 |
| --- | --- | --- |
| macOS | 钥匙串 | 总可用 |
| Windows | DPAPI（按 Windows 用户加密） | 总可用 |
| Linux | Secret Service（`gnome_libsecret`）或 KWallet（`kwallet` / `kwallet5` / `kwallet6`） | 取决于桌面环境 |

Linux 上 Chromium 只按桌面环境选密钥服务：`X-Cinnamon`、`Deepin`、`GNOME`、`Pantheon`、`XFCE`、`UKUI`、`Unity` 选 libsecret，KDE 选 KWallet，**其余一律 `basic_text`**：用写死在源码中的密钥「加密」，等同明文。MATE、LXQt、平铺窗口管理器、`XDG_CURRENT_DESKTOP` 为空的 xrdp / VNC 会话即使 gnome-keyring 正在运行也是这样（D167 实测，Electron 44、Linux arm64 容器，gnome-keyring 已解锁）：

| 环境 | 不加开关 | `--password-store=gnome-libsecret` |
| --- | --- | --- |
| 没有 `XDG_CURRENT_DESKTOP` | `basic_text`，不可用 | `gnome_libsecret`，可用（`v11` 密文，往返正确） |
| `MATE` | `basic_text`，不可用 | `gnome_libsecret`，可用 |
| `UKUI`（麒麟） | `gnome_libsecret`，可用 | 同左 |
| 装了 gnome-keyring 但没有登录密钥环、也弹不出解锁框 | — | `gnome_libsecret`，不可用 |

Electron 44 默认把 `basic_text` 报告为不可用（`isEncryptionAvailable()` 为 `false`；只有 `setUsePlainTextEncryption(true)` 才会可用），main 仍另外要求 `safeStorage.getSelectedStorageBackend()` 不是 `basic_text` / `unknown`（D74）：这里判断错了就是明文写盘。

因此（D167）：

- main 在 `ready` 之前（Chromium 启动时就选定密钥服务）追加 `--password-store=gnome-libsecret`（`apps/desktop/src/main/password-store.ts`），除非用户自己传了 `--password-store`，或是 KDE 会话（`XDG_CURRENT_DESKTOP` 含 `KDE`、设置了 `KDE_FULL_SESSION`、`DESKTOP_SESSION` 以 `kde` 开头）：KWallet 里已存的密文换到 libsecret 就解不开。其他桌面环境上 Chromium 本来就选 libsecret，开关不改变什么；KeePassXC、KDE Plasma 6 的 ksecretd 也提供 Secret Service。
- 系统密钥服务仍不可用（没装、没有登录密钥环）时：加解密请求返回失败，引导页「凭据存储」为警告（不阻止「就绪」），说明安装 `gnome-keyring`（统信、麒麟同样 `apt install`）后重启应用；装不了时可以设置主密码（14 §3.1）：由后端 credentials 模块用 scrypt 派生的密钥包住数据密钥、AES-256-GCM 加密凭据（10 §credential_vault），每次启动输入一次。仍不退回明文。
- 锁定期间（D178）：所有页面顶部有解锁提示条，`CREDENTIAL_LOCKED` 的错误下面就地解锁；AI 的数据库工具带 hint 请用户解锁（12 §6.10）；定时任务照常运行。
- 引导页的状态来自 `EnvironmentDTO.credentials`（后端经 credential port 的 `status` 请求询问 main，再加上主密码的状态）。
- Playwright 的 Electron 加载器在应用之前追加 `--password-store=basic`，应用把它当作用户的选择保留：Electron E2E 里系统密钥服务总是不可用；J42 的 Secret Service 用例因此不经加载器、直接启动构建后的应用（07 §5）。
- 开发模式（`pnpm dev:server`、浏览器 E2E）的明文适配器报告可用，与现状一致。

### 3.7 引导页与界面文案

- `EnvironmentDTO` 增加 `platform`（`darwin` / `win32` / `linux`，后端的 `process.platform`，D75）。前端只用它选择文案，不自己猜测操作系统。
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

### 3.8 打包（electron-builder 26，D76）

| 平台 | 目标 | 说明 |
| --- | --- | --- |
| macOS | dmg arm64 | 不变 |
| Windows | NSIS x64，`oneClick: false`、可改安装目录、按用户安装 | 未签名：SmartScreen 提示「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」 |
| Linux | AppImage 与 deb，各 x64、arm64（D160） | 未签名。配置里不写架构：`pnpm dist` 打本机架构，`pnpm dist --x64 --arm64` 两种都打（配置里写了架构会盖过命令行参数）。应用不打包原生模块，两种架构在任一台机器上都能打；CI 在各自架构的运行器上只打本机架构，与 Electron 冒烟同一架构。deb 包名与可执行文件名 `agent-workflow`，维护者字段取 `linux.maintainer`；electron-builder 的默认 deb 依赖已含 `libsecret-1-0`（凭据存储，§3.6） |

- 图标（D190）：`build/icon.svg` 是唯一来源，渲染出 `build/icon.png`（1024 px，Windows 转 ico、Linux 用）与 `build/icon.icns`（16–1024 px 的 iconset 经 `iconutil` 打包）；侧栏品牌图标 `logo` 是同一图形的线稿。
- 安装位置：deb 装到 `/opt/Agent Workflow/`（electron-builder 的 `/opt/<productName>`），`update-alternatives` 建 `/usr/bin/agent-workflow`，菜单项 `/usr/share/applications/agent-workflow.desktop`，图标装进 hicolor；AppImage 不安装。用户数据都在 `~/.config/Agent Workflow/`。
- 桌面快捷方式（D191，`desktop-shortcut.ts`）：打包后的应用在 Linux 第一次启动时往桌面（`app.getPath('desktop')`，读 `user-dirs.dirs`，中文系统为 `~/桌面`）放 `agent-workflow.desktop`：deb 复制它的菜单项；AppImage 写一个启动 `$APPIMAGE` 当前位置的条目，图标复制到用户数据目录。文件可执行，再用 `gio set … metadata::trusted true` 让 GNOME 桌面图标直接可启动（没有 `gio` 时只记日志，需在图标右键「允许启动」）。用户数据目录里的标记文件 `desktop-shortcut` 记下已放过，删掉的快捷方式不再出现；没有桌面目录或两种都不是（其他安装方式）时不放、下次再试。没在 Linux 真机验证。
- `pnpm dist` 构建当前平台的安装包（`electron-builder` 不带平台参数，按各平台的 `target` 配置），CI 在各自的 runner 上运行。
- Linux 的已知限制（README 说明，**需要用户在真机确认**）：
  - Ubuntu 24.04 默认用 AppArmor 限制非特权用户命名空间，Chromium 沙箱无法启动 AppImage（报 `The SUID sandbox helper binary was found, but is not configured correctly`）。deb 安装会带上 SUID 的 `chrome-sandbox`，不受影响；AppImage 需要按 README 放行或使用 deb。不以 `--no-sandbox` 作为默认。
  - AppImage 需要 FUSE 2（Ubuntu 22.04 默认有，24.04 需 `sudo apt install libfuse2t64`）。

### 3.9 应用助手（v1.1，15）

- 工作目录 `<数据目录>/assistant/`（`files/<对话 id>/`、`conversations/`）只经 `node:path` 拼接，`mkdirSync({ recursive: true })` 创建，三平台一致。
- `list_files` / `reveal_file` 与附件识别判断「是否在本对话目录内」用 `path.relative` + 不以 `..` 开头 + 不是绝对路径：Windows 上 `relative` 不区分大小写，跨盘符时返回绝对路径，同样被拒绝；返回给模型与界面的相对路径用本机分隔符。
- `aw-assistant` 会话与执行会话共用 opencode 的 `shell` 配置：Windows 上同为 Git Bash，助手的 bash 规则按 bash 语义成立（D72）。
- 界面文案：打开助手与发送的快捷键提示随平台写 ⌘ / Ctrl；「在 Finder 中显示」在 Windows 写「资源管理器」、Linux 写「文件管理器」（`copy/assistant.ts` 按 `UI_PLATFORM`）；`shell.showItemInFolder` 三平台可用。

### 3.10 知识问答（v1.1，18）

- 引用路径校验（`knowledge.citations.ts`）：模型给出的路径用 `path.resolve` 接到 `realpath` 后的仓库根下，再用 `relative` 判断是否越界（Windows 上跨盘符时 `relative` 返回绝对路径，被拒绝；`/etc/hosts` 在 Windows 上也是绝对路径）；`.git` 目录的判断在 `realpath` 之后再做一次，Windows 上写成 `.GIT` 也会被 `realpath` 还原成磁盘上的大小写而拒绝。存储与显示的引用路径统一为 `/` 分隔（`relative(...).split(sep).join('/')`），文件类型分类按 `/` 进行，三平台一致。
- **行号与 CRLF**：Windows 上 `core.autocrlf=true` 的检出文件是 CRLF。按行切分原先只认 `\n`，每行会带着 `\r` 进入摘录与原文窗口；改为同时识别 `\r\n`（集成测试覆盖），行号不变。
- 研究会话的 JSONL 在 `runs/knowledge/<attemptId>.jsonl`，经 `node:path` 拼接；`aw-researcher` 与执行会话共用 opencode 的 `shell` 配置（Windows 上为 Git Bash，D72），只读规则按 bash 语义成立。

### 3.10a 浏览器（v1.3，29）

- 离屏 `WebContentsView`、`webContents.debugger`、请求拦截用的都是 Electron 的跨平台接口，平台差异只有 DPR：AI 的标签页一律用设备指标设视口、DPR 为 1，截图在三个平台一致。实测只在 macOS 上做过（29 §12），Windows 与 Linux 未验证。
- 预览命令的推断（`projects.inference.ts`）在三个平台一致；命令由 POSIX shell 执行，`$PORT` 与 `PORT` 环境变量同样有效。
- 浏览器 E2E 的后端把 `HOME` 换成临时目录，开发用的浏览器宿主（playwright-core）按 `HOME` 找浏览器，`e2e/global-setup.ts` 因此按平台设 `PLAYWRIGHT_BROWSERS_PATH`（macOS `~/Library/Caches/ms-playwright`、Linux `~/.cache/ms-playwright`、Windows `%LOCALAPPDATA%\ms-playwright`）。

### 3.11 其他检查过、无需改动的点

- 端口与地址：都绑定 `127.0.0.1`；Windows 防火墙对环回地址不弹窗。
- SQLite（`node:sqlite`）、JSONL 日志、迁移文件：只用 `node:path` 拼接，跨平台。
- opencode 插件文件以 `pathToFileURL` 传给 opencode，Windows 上为 `file:///C:/...`，正确。
- 数据库 MySQL 驱动、托管平台 HTTP：与平台无关。
- 后端脚本（`scripts/*.mjs|ts`）只用 `node:path`；`scripts/check-prod-bundle.mjs` 读取构建产物，跨平台。


### 3.12 从 Finder / 桌面启动时的 PATH 与环境变量（D117、D161）

**问题。** 从 Finder、Dock 或 Launchpad 启动时，launchd 给应用的 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`；Linux 从桌面启动器启动时同样只有系统会话的 PATH，没有 `~/.nvm`、`~/.sdkman` 等。后端把这个 PATH 传给检查命令（`/bin/sh -c`，`extendEnv: false`）、opencode 与 git，于是 `mvn`、`pnpm`、`node`、`java` 在终端里能用、在应用里报 `command not found`（退出码 127）。opencode 的 bash 以 `$SHELL -l -c` 运行，只读登录脚本，写在 `.zshrc` 里的 PATH 也拿不到。

内网部署时同样的问题出在其他变量上：内网 provider 的 API key、`OPENCODE_DISABLE_*`、`NODE_EXTRA_CA_CERTS`、代理变量写在启动脚本里，应用里拿不到（D161）。

**处理。** 桌面 main（`shell-path.ts`）在启动后端前运行一次 `<登录 shell> -ilc 'printf 标记; env -0; printf 标记'`：

- 登录 shell 取用户账户里登记的那个（`os.userInfo().shell`），`-i -l` 与终端打开时读同样的启动脚本（`.zprofile`、`.zshrc`、`.bash_profile`、`.bashrc` 等）。shell 在自己的会话中运行（`detached`），从终端启动时不会抢占终端。
- 启动脚本可能在命令前后打印横幅等杂讯，只取两个标记之间的内容；读到第二个标记就结束等待，不等启动脚本留下的后台进程关闭输出。`printf` 与 `env -0` 在 sh、bash、zsh、fish 中写法相同；`env -0` 以 NUL 结束每个变量，值里的换行与 `=` 原样保留（macOS、GNU、BusyBox 的 `env` 都支持）。
- 变量（D161）：去掉描述那个 shell 自身的 `PWD`、`OLDPWD`、`SHLVL`、`_`；当前环境已有的变量保持当前的值（从终端启动时以用户在终端里导出的为准），只补上当前没有的。
- PATH 合并：当前 PATH 已包含登录 shell 的全部目录（从终端启动）时**原样不变**；否则按登录 shell 的顺序，再接上只有当前 PATH 才有的目录（`/opt/homebrew/bin` 排在 `/usr/bin` 之前，`/usr/bin/java`、`/usr/bin/git` 是转发程序）。
- 10 s 内没有打印出环境、shell 失败或退出时：main 的日志写明原因（含 shell 的 stderr 结尾），后端沿用原环境，应用照常启动。
- Windows 不处理：环境变量来自注册表，每个进程都完整。
- 本机实测（zsh、Homebrew）约 50 ms，与打开动画（1.2 s）同时进行。

**测试。** `shell-path.int.test.ts` 用一个假的登录 shell（启动时打印杂讯、加入 `/opt/fake-brew/bin` 并导出变量）验证：从 Finder 启动时后端的 PATH 按登录 shell 的顺序带上该目录、补上登录 shell 导出的变量、当前已有的变量不被覆盖、shell 自身的变量不带；从终端启动时 PATH 不变、变量以当前的为准；值含换行与 `=` 时原样带上；shell 失败或不结束时沿用原环境。假 shell 是 sh 脚本，这三例在 Windows 上跳过（该机制在 Windows 上不运行，「Windows 不问登录 shell」一例三平台都运行）。从打包应用里真正读到用户的 shell 配置只能手工验证：`pnpm dist` 打包、从 Finder 启动，跑一个 `mvn` 或 `pnpm` 检查命令。

### 3.13 企业 CA 与代理（D164、D165、D174–D176）

**问题。** 后端是 Electron utilityProcess 里的 Node：TLS 只信任 Node 自带的根证书，不读系统证书库；fetch 不读 `HTTPS_PROXY`。内置浏览器（Chromium）却读系统证书库、跟随系统代理（含 PAC），所以同一个企业 GitLab 浏览器能开、后端报证书错误，github.com 在「外部走代理」的内网里后端连不上。

**处理（`modules/network`）。**

- 信任：后端启动时与设置 `network.extraCaCerts` 变化时调用 `tls.setDefaultCACertificates`，列表为 `bundled`（Node 内置）+ `extra`（`NODE_EXTRA_CA_CERTS`，启动时由 Node 读入；Electron 44 的 utilityProcess 实测会读）+ `system`（系统证书库）+ 设置里的证书。fetch（Octokit、Gitbeaker）与 mysql2、pg、gaussdb-node、tedious 都不传自己的 `ca`，用的就是这份默认列表。系统证书库各平台来源：macOS 为钥匙串中受信任的证书，Linux 为 OpenSSL 默认目录（`/etc/ssl/certs` 等，`update-ca-certificates` 写入的位置），Windows 为系统证书存储（Windows 暂缓，未验证）。
- 代理：生效的变量为 `network.proxy` 有值时的它与 `network.noProxy`，否则为环境变量（小写优先，与 curl、Node、bun 相同）。有生效的代理时，后端在 `127.0.0.1` 的随机端口上开一个**转发代理**（`network.forward.ts`，D174），`http.setGlobalProxyFromEnv` 把 fetch 的全局 dispatcher 与 `http(s).globalAgent` 指向它（每次先还原上一次的设置），`NO_PROXY` 只剩 `localhost,127.0.0.1,[::1]`（Node 只认带方括号的 IPv6 写法，实测）。转发代理按生效的 `NO_PROXY` 决定每个请求直连还是经上游代理：一处匹配（`network.no-proxy.ts`），认网段、`*.域名` 与端口。只有拿到本次运行口令的进程能用它（代理 URL 的密码；用户名 `http` / `https` 说明请求的协议：Node 对 http 网址也用 CONNECT，隧道本身看不出该用哪个上游）。数据库连接是 TCP，不经代理。
- 为什么要转发代理（实测，2026-10-25）：Node 24.19 / Electron 44 的 Node 24.22 与 bun 1.3.14 都不认 `10.0.0.0/8`、`10.*`、`127.0.0.*`，只认完整的主机名、IP、`主机:端口` 与单独的 `*`，并按字符串后缀匹配（`.0.0.1` 会匹配 `127.0.0.1`）；bun 不认 `*.corp.example`。git（Apple 2.50 / Homebrew 2.45，libcurl 8.7）认网段、不认 `*.corp.example` 与 IP 后缀；Ubuntu 22.04 的 curl 7.81 还不认网段（7.86 起）。
- opencode（bun 1.3.14）：每次启动带 `NODE_USE_SYSTEM_CA=1`；设置里有证书时，把「后端从 `NODE_EXTRA_CA_CERTS` 读到的 + 设置里的」写到 `<数据目录>/network/extra-ca.pem`，`NODE_EXTRA_CA_CERTS` 指向它；有生效的代理时代理变量（大小写各一份）指向转发代理。CA 的改动要重启 opencode 才生效（运行环境页「重启」）；代理地址与 `noProxy` 的改动由转发代理立即应用，只有从没有代理到有代理（或反过来）要重启。
- git（D175）：与远端通信的命令（Git 工作台的推送、拉取、取回，任务的 PR 推送与审查意见取回）经 `GIT_CONFIG_COUNT` 注入：设置里有证书时 `http.sslCAInfo=<数据目录>/network/git-ca.pem`（后端的整份信任列表：内置根证书 + `NODE_EXTRA_CA_CERTS` + 系统证书库 + 设置）；有生效的代理时 `http.proxy` 为转发代理（`https` 那个：git 只为 https 网址建隧道，http 网址以绝对地址转发，转发代理按 http 选上游）、`http.proxyAuthMethod=basic`（git 默认先不带凭据请求，收到 407 后重试，而转发代理拒绝后就关闭连接），`NO_PROXY` 只剩本机地址。证书包要完整，因为 git 用哪套 CA 因安装方式而异（实测）：macOS 上 Apple 与 Homebrew 的 git 都链接系统 libcurl（LibreSSL），`http.sslCAInfo` 叠加在钥匙串之上；Linux 发行版的 git 用 OpenSSL，`http.sslCAInfo` 替换默认证书包。注入会盖过用户 git 配置里不分网址的 `http.sslCAInfo` / `http.proxy`；按网址的 `http.<url>.*` 仍然优先。SSH 远端不受影响。
- 内置浏览器（D176）：`network.proxy` 有值时用它（`session.setProxy`，bypass 由 `noProxy` 换算：名称加上 `*.` 子域名，网段与 IP 原样，Chromium 自己认网段），否则跟随系统代理与 PAC，环境变量的代理不作用于浏览器；设置里的 CA 经分区的 `setCertificateVerifyProc` 与 `certificate-error` 额外信任（检查见 29 §5.4）。
- 不处理：需要账号密码的代理不能写进设置（设置明文保存），继续用环境变量（转发代理把 URL 里的账号密码交给上游）；NTLM / Kerberos 代理认证不支持；AI 在会话里自己运行的 git 不经此处（它继承 opencode 的代理变量，CA 用自己的配置）。

**测试。** `network.no-proxy.test.ts`：各种 `NO_PROXY` 写法。`network.int.test.ts`：FakeHosting 以测试 CA 签发的证书提供 HTTPS，加 CA 前报 `HOSTING_UNREACHABLE`、加上后成功；测试代理记录 CONNECT，自建 GitLab 用只有代理能解析的主机名，验证环境变量、设置覆盖与 `noProxy`；`127.0.0.0/8` 时按 `[::ffff:127.0.0.1]` 访问的 GitLab 直连（本机地址列表不含这个写法，只有网段能让它直连）；假 opencode 记录启动环境，测试经它拿到的转发代理建隧道；真实 git 与 `git http-backend` 的 HTTPS 服务：加 CA 前推送因证书失败、加上后推送与取回成功，设置的代理下经代理到达只有代理能解析的远端；http 远端经代理转发，不走代理的网段里按 IP（`[::ffff:127.0.0.1]`）写的远端直连（转发的请求不能再用全局 agent，否则又回到转发代理）。Ubuntu 的 git 链接 GnuTLS，证书错误的措辞与 OpenSSL 不同（`server certificate verification failed`）。`network.oc.test.ts`（`@opencode`）：真实 opencode 经转发代理与上游代理连上只有代理能解析、企业 CA 签发证书的模型服务。浏览器：`browser-network.test.ts`（证书检查）与 `browser-host.electron.spec.ts`（真实 Chromium 的 CA 与代理）。系统证书库只能手工验证：把测试 CA 加入钥匙串（Linux：`/usr/local/share/ca-certificates` + `update-ca-certificates`），不加设置，保存企业 GitLab 的令牌。

### 3.14 窗口标题栏（D188）

系统标题栏（Linux 上还有 Electron 默认菜单「File Edit View Window」）用系统的颜色，不随应用主题变。Windows 与 Linux 上 main 建窗口时 `titleBarStyle: 'hidden'`，`titleBarOverlay` 由系统在顶栏右端画最小化 / 最大化 / 关闭三个按钮：底色为主题的 `bg`，符号为 `sub`，高 56px（`--header-h`）；颜色与打开动画一样取自 `@aw/web/splash`（`titleBarOverlay`）。界面每次应用主题都会发 `aw:launch-preferences`（28 §5.3），main 收到后除了写 `launch.json` 还调用 `setTitleBarOverlay`，按钮随主题即时变色。macOS 保留系统标题栏，不变。

- 移动窗口：顶栏（`.header`）与侧栏品牌区是 `-webkit-app-region: drag`，其中的按钮、链接、输入框为 `no-drag`；打开动画顶部同样高度的一条可拖动（其余部分仍可点击跳过动画）。
- 让出按钮的位置：顶栏右侧内边距加上 `100vw - env(titlebar-area-x) - env(titlebar-area-width)`（只有隐藏了标题栏的窗口才有这组环境变量，其他平台与浏览器里为 0）；右侧抽屉从 `env(titlebar-area-height)` 开始，关闭按钮不被窗口按钮挡住。
- 拖动区域会吃掉盖在它上面的元素的点击，所以遮罩、抽屉、对话框都是 `no-drag`。
- 只用 CSS 环境变量与 main 的一处判断，界面代码不判断平台（D71）。菜单栏不再显示；默认菜单仍在，它的快捷键（缩放、开发者工具等）在 Linux 上是否照常可用尚未实测。
- 验证：macOS 上浏览器 E2E 与 Electron 冒烟覆盖不变的部分；Linux 上的样子需要真机或 CI 打出的包手工查看（未在本机验证）。

## 4. 测试与 CI

### 4.1 GitHub Actions（`.github/workflows/ci.yml`）

工作流只在手动触发时运行（见下文「何时运行与当前的验收」）。平台为 Linux x64（`ubuntu-24.04`）、Linux arm64（`ubuntu-24.04-arm`）与 macOS；Windows 暂缓，不在矩阵里（D160）。各平台运行同一组检查与测试：`pnpm verify` 的各步骤（`check`、`test`、`test:int`、`build`）、浏览器 E2E `pnpm e2e`（FakeOpencode）、Electron 启动冒烟 `pnpm e2e:smoke`（J15：打包前的构建产物启动、后端握手、显示引导页、四项检测有结果；Linux 下用 `xvfb-run`）；两个 Linux 运行器另外各打本机架构的包，并把安装包（`release/*.AppImage`、`*.deb`）作为 artifact 上传。依赖安装（Node 24、pnpm 10.28、按锁文件哈希缓存的 pnpm store）由 `.github/actions/setup` 统一完成。

**两个 Linux 运行器拆成并行的 job（D81；原为 ubuntu 与 windows，D160 起 windows 换成 arm64）。** 拆分时仓库是私有的，runner 只有 2 个 vCPU：vitest 默认的 worker 数是 CPU 数减 1，集成测试逐个文件串行；浏览器 E2E 共用一个后端，本来就是一个 worker。因此在这两个平台上把测试分到同时运行的多台机器上：

| job | 内容 |
| --- | --- |
| `check (os)` | `pnpm check`、`pnpm test` |
| `test:int (os, i/2)` | `pnpm test:int --shard=i/2`（vitest 按文件分片） |
| `e2e (os, i/2)` | `pnpm build`、拉取 `postgres:17.6`（J21 要用，没有镜像时跳过）后 `pnpm e2e --grep-invert @walkthrough --shard=i/2`（除 J9 外的浏览器 E2E，Playwright 按文件分片） |
| `e2e J9 (os, i/4)` | `pnpm build` 后 `pnpm e2e --grep @walkthrough --shard=i/4`：J9 每套主题一个用例，一片一套主题 |
| `package (os)` | `pnpm build`、Electron 启动冒烟（含 J42 的主密码一例）、带 Secret Service 的凭据存储（`dbus-run-session` 里解锁 gnome-keyring 后以 `AW_E2E_SECRET_SERVICE=1` 再跑 `credentials.electron.spec.ts`，D167）、`pnpm dist`、上传安装包 |

macOS 仍是一个 job，按上面的顺序串行跑完：它约 3 分钟，比拆分后的 Windows 还快，而 macOS runner 按 10 倍计费，拆开只增加费用。

**何时运行与当前的验收（D82，用户确认）**：

- **当前的验收以本机 macOS 的全量验证为准**：主会话验收每个 PR 时在本机运行 `pnpm verify`、`pnpm e2e`、`pnpm test:oc`、`pnpm e2e:electron`，通过后合并。
- **三平台 CI 不自动运行**：工作流只有 `workflow_dispatch` 触发，PR、推送到 main 与 tag 都不触发。发布正式版本前，或某个改动需要在 Windows / Linux 上确认时，手动运行（GitHub 的 Actions → CI → Run workflow，或 `gh workflow run ci.yml --ref <分支>`）。手动运行时三个平台都跑，上面的拆分与分片照样生效。
- **跨平台代码照常写**：平台差异仍只在 `core/platform.ts` 等三处处理（D71），平台相关的单元测试（如 `platform.test.ts`）不依赖运行平台，在 macOS 上也会运行。Windows / Linux 的真机验证与三平台 CI 推迟到正式版本之前（§5）。

分片的取值是 `i/N`，N 与矩阵列表写在一起；Playwright 与 vitest 的分片都是把全部用例按顺序切成 N 份，各片的并集就是全部用例，新增的 spec 或测试文件自动进入某一片。J9 原来是一个循环四套主题的用例（Windows 上 4.5 分钟，无法分片），现拆成每套主题一个用例（`walkthrough.browser.spec.ts`，标签 `@walkthrough`）：该 describe 设为 `parallel` 只为让分片能把它们分开；本机一个 worker 时四个用例依次运行、共用 `beforeAll` 的一次种子数据，与原来相同。

**结果与重跑。** job 内后面的步骤在前面失败后照常运行，一轮能看到该 job 的全部问题；任何一步失败，该 job 失败，整个 run 也就失败。只重跑失败部分用 GitHub 自带的「Re-run failed jobs」（或 `gh run rerun <run-id> --failed`），不另做机制。失败时 E2E 的 trace（`retain-on-failure`）连同 `test-results/` 作为 artifact 上传（`e2e-results-*`、`walkthrough-results-*`），后端日志在 CI 中输出到 job 日志。

**打包产物何时产生**：只在手动运行工作流时产生，ubuntu 与 windows 每次运行都打包并上传安装包；macOS 不打包（本机用 `pnpm dist`）。打包与测试同时进行：实测 Windows 的 `package` job（3.2–3.3 分钟）与最长的测试 job（3.0–3.5 分钟）相当，不拖长一轮。

**Playwright 只装 Chromium 的 headless shell**（`--only-shell`，浏览器 E2E 以 headless 运行，原来也只用它），系统依赖只在 Linux 上装（`--with-deps`）：Windows 上的 `--with-deps` 会花约 3.5 分钟启用 Media Foundation 功能，没有 spec 播放媒体（§4.3）。

**数据库集成测试在两个 Linux 运行器上运行（D160 前只在 ubuntu x64）。** SQL Server 与 openGauss 只发布 x64 镜像：arm64 上不拉取，相应用例按 `db-containers.ts` 的规则跳过，由 x64 覆盖；MySQL 与 PostgreSQL 两种架构都跑。以下为原说明： `databases.int.test.ts` 与 `databases.engines.int.test.ts`（v1.2，24 §7）需要 Docker 中的 Linux 容器（`mysql:8.4`、`postgres:17.6`、openGauss、SQL Server）：GitHub 的 Windows runner 的 Docker 只能运行 Windows 容器，macOS runner 没有 Docker。工作流在这两个平台对 `test:int` 显式排除这两个文件并在步骤名与注释中写明原因；代码中不按平台跳过（缺 Docker 时测试照常失败）。该测试与平台无关（只经 TCP 访问 MySQL），在 ubuntu 上运行即覆盖。

**不进 CI**：`test:oc`、`test:live`、J10（`journey.electron.spec.ts`）需要真实 opencode、登录的模型与网络，仍在本机运行。

**浏览器 E2E 不经 Vite 开发服务器。** 后端先 `vite build` 出开发模式的前端（保留开发页面），再像打包应用一样同源托管它。CI 的 J9 trace 显示：Vite 客户端的 HMR 连接偶发断开后会 `location.reload()`，正在加载的模块请求全部中止，页面停在未渲染状态（`data-theme` 等不到，M6 遗留的偶发失败即此）；按需转换的几百个模块也让 Windows 上每次打开页面都很慢。改为构建产物后，本机 E2E 从 4.9 分钟降到 1.9 分钟。

**各平台的实测耗时**（CI，同一提交 cbdd21a；E2E 后端在 CI 中以 info 级别记录状态转换，时间取自日志）：

| | macOS | Ubuntu | Windows |
| --- | --- | --- | --- |
| 集成测试总耗时（Windows 与 macOS 不含 MySQL） | 14 s | 91 s（含 MySQL 容器） | 242 s |
| 建 worktree（preparing → 工作区就绪），中位 / 最大 | 42 / 125 ms | 107 / 340 ms | 542 / 6259 ms（另一轮最大 9.3 s） |
| 节点验收（verifying → 下一状态，检查命令 + 提交），中位 / 最大 | 60 / 102 ms | 174 / 512 ms | 892 / 3795 ms |
| 一次 Git Bash 检查命令（`acceptance.command.int.test.ts` 3 个用例合计） | 149 ms | 89 ms | 548 ms |
| J4 从开始到任务失败 | 0.2 s | 0.8 s | 3.6 s |
| 一次 squash 合并（review → completed），其他两个任务仍在提交时 | — | — | 2.9 s（无竞争时 0.3–0.7 s，另一轮的长尾 16 s） |
| J6 / 三任务并发合并 整个用例 | 2.8 / 3.0 s | 7.9 / 10.2 s | 17.6 / 20.2 s |

慢集中在启动进程上（每次 git 与 Git Bash 约 100 ms 以上，一个节点的提交要十几次 git 调用）。排查过的 Windows 特有原因：Defender 实时扫描在 runner 上本来就是关闭的（`RealTimeProtectionEnabled : False`，曾临时加的排除步骤已去掉）；`core.fsmonitor` / `core.preloadindex` 影响 `status` 的文件扫描，对这些只有几个文件的测试仓库没有可省的；进程启动开销是平台本身的成本。处理：集成测试的 `testTimeout` 与 `waitForEvent` 默认等待按最慢的 Windows 留余量；E2E 只对等待整个任务运行、建工作区或合并的断言（开始后进入任务页、结果卡出现、合并结果：J1–J8、J4 的失败面板）在 Windows 上放宽到 20 s（`e2e/helpers.ts` 的 `TASK_RUN_TIMEOUT_MS`），其余断言保持 5 s；一个用例里串起多个任务与合并的交付用例在 Windows 上标 `test.slow`（`GIT_HEAVY_SPECS_SLOW`）。

### 4.2 测试代码中的平台差异

只在测试辅助函数中处理，测试用例本身不写平台判断：

- `test/helpers/executables.ts`：`writeFakeExecutable(dir, name, source)` 写一个用 Node 运行 JS 模块 `source` 的假命令（Windows 上是 npm 形式的 `<name>.cmd`，其他平台是可执行的 sh 脚本）；`isolatedEnv(bin, home, { git })` 构造只找得到 `bin`（和 git）的环境（POSIX 上软链接 git；Windows 上加入 git 自己的目录，因为 Git for Windows 的 `git.exe` 依赖安装目录的相对位置，另保留 `SystemRoot`、`ComSpec` 等 Windows 程序需要的变量）。
- E2E 中跨整个任务运行的等待：`e2e/helpers.ts` 的 `TASK_RUN_TIMEOUT_MS`（只在 Windows 上放宽，数据见 §4.1）。
- 浏览器 E2E 的假 opencode：`e2e/fixtures/bin/` 同时有 `opencode`（sh）与 `opencode.cmd`；PATH 用 `path.delimiter` 拼接，主目录同时设 `HOME` 与 `USERPROFILE`。
- 唯一的例外：`apps/desktop/src/main/shell-path.int.test.ts` 中读登录 shell 的三例在 Windows 上跳过（`describe.skipIf`），被测机制只在 macOS / Linux 运行（§3.12）。

### 4.3 CI 耗时（D81）

改动前取 PR #10 的三轮全绿运行（39556036848、39559586194、39568342291），改动后取 PR #15 的运行 39597198853（第一次尝试；最长的 job 与整轮时间另含 39598819067）；单位为秒，范围为多轮或多个分片的最小与最大值。拆分后每个阶段在各自的 job 里运行，「准备」与 Playwright 安装在每个需要它的 job 中各有一次。

| 阶段 | Ubuntu 改动前 | Ubuntu 改动后 | Windows 改动前 | Windows 改动后 |
| --- | --- | --- | --- | --- |
| 准备（job 启动、checkout、pnpm、Node、安装依赖） | 14–17 | 11–17（每个 job） | 47–53 | 39–56（每个 job，一次 82） |
| Playwright 安装 | 29–33 | 19–29 | 222–251（其中 ~205 为 Media Foundation） | 11–15 |
| `pnpm check` | 34–44 | 33 | 53–79 | 59 |
| `pnpm test` | 8–9 | 8 | 13–30 | 14 |
| `test:int`（Ubuntu 含拉取 MySQL 镜像 24 s） | 91–109 | 55 / 76（两片） | 194–258 | 84 / 117（两片） |
| `pnpm build` | 4–5 | 3–7 | 8–9 | 5–7 |
| 浏览器 E2E，J9 以外 | 52–71 ¹ | 36 / 40（两片） | 138–177 ¹ | 61 / 84（两片） |
| 浏览器 E2E，J9 | 150–192（一个用例） | 45–70（每套主题） | 264–282（一个用例） | 74–93（每套主题） |
| Electron 启动冒烟 | 9–11 | 12 | 17–22 | 19 |
| `pnpm dist`（Windows 中 NSIS 压缩约 75 s） | 86–104 | 92 | 105–140 | 108 |
| **最长的 job（该平台的反馈时间）** | **503–613（8.4–10.2 分钟）** | **138–145（2.3–2.4 分钟，`package`）** | **1163–1303（19.4–21.7 分钟）** | **191–209（3.2–3.5 分钟，`package` 或一片 J9）** |

¹ 改动前 E2E 是一个步骤，表中为每轮的步骤耗时减去该轮 J9 与 webServer 启动（构建前端 + 后端启动：Ubuntu 6 s、Windows 27 s，改动后每片各有一次）。

macOS 不变：一个 job 2.9–3.6 分钟（改动后 3.1–3.5 分钟）。整个 run 从创建到结束由 Windows 决定，改动前约 20–22 分钟，改动后 4.0–4.7 分钟；后者中有时约 1.5 分钟是排队：账户的并发 job 数有上限（GitHub Free 为 20），上述两轮有 21 个 job，同时还有其他分支的运行占用名额，部分 job 晚 1–2 分钟才开始。

**计费分钟**。GitHub 把每个 job 的耗时向上取整到分钟再乘平台倍数（Linux ×1、Windows ×2、macOS ×10）。改动前取 PR #10 的三轮，改动后取运行 39597198853 与 39598819067；「实际」为取整后、换算前的分钟数：

| 平台（倍数） | 改动前，每轮 实际 / 计费 | 改动后，每轮 实际 / 计费 |
| --- | --- | --- |
| Ubuntu（×1） | 9–11 / 9–11 | 21 / 21 |
| Windows（×2） | 20–22 / 40–44 | 31–32 / 62–64 |
| macOS（×10） | 3–4 / 30–40 | 4 / 40 |
| **合计** | **32–37 / 79–95** | **56–57 / 123–125** |

拆分使 Ubuntu 与 Windows 的实际分钟增加（每个 job 各有约 1 分钟准备，且各自向上取整）。改动前每个 PR 的每次推送与每次合并都自动跑一轮（PR #10 一个 PR 跑了 18 轮），用尽了账户的 Actions 额度；现在只在手动运行时消耗（D82）。

**看过但没有采用的手段**：

- 缓存 Playwright 浏览器、Electron 与 electron-builder 的下载：实测下载本身不慢（headless shell 在 Windows 上约 10 s，electron-builder 的 Electron 与 NSIS 不到 1 s），恢复缓存的开销相当；pnpm store 已由 `setup-node` 按锁文件哈希缓存，安装 4–14 s。
- Defender 排除：runner 上实时扫描本来就关闭（§4.1）。
- `core.fscache` 等 git 设置：慢在每次启动进程（§4.1），测试仓库只有几个文件，没有可省的文件扫描；没有数据支持，不加。
- 在 2 vCPU 上提高 vitest 的 worker 数：没有实测；跨机器分片的收益是确定的，已足够。

**测试集合的变化**：每个平台运行的检查与测试与改动前相同，逐项为：

- J9 由一个用例拆成每套主题一个用例，页面、模式、主题与断言不变（页面错误、`role="alert"`、对比度与横向溢出问题、截图）；种子数据每次运行（或每个分片）一份。
- Playwright 不再下载完整的 Chrome for Testing（浏览器 E2E 一直用 headless shell）；Windows 不再启用 Media Foundation。
- `package` job 不安装 Playwright 浏览器（Electron 冒烟用 Electron 自带的 Chromium）。

## 5. 验收

| 项 | 方式 | 由谁 |
| --- | --- | --- |
| 三平台 `pnpm verify`（Windows / macOS 除数据库集成测试）、浏览器 E2E、Electron 启动冒烟 | CI 全绿 | CI |
| Windows NSIS 与 Linux AppImage / deb 能打出来 | CI artifact | CI |
| 本机 macOS：`pnpm verify`、`pnpm e2e`、`pnpm test:oc` | 本机运行 | 开发者 |
| **Windows 真机**（暂缓，D160）：安装 NSIS 包（SmartScreen 放行）→ 引导页三项检测（Git for Windows、opencode 1.19.0、模型）→ 添加项目 → 跑通一个「修 Bug」任务 → 合并；任务中模型执行 bash 命令时只读规则生效（规划阶段不弹权限请求）；取消运行中的任务后 worktree 能被清理 | 手动 | **需要用户完成** |
| **Linux 真机（Ubuntu 22.04 / 24.04 桌面，x64 与 arm64 各一台）**：安装 deb 与运行 AppImage（24.04 的 AppArmor 限制）→ 引导页三项检测与「凭据存储」→ 绑定托管平台令牌（GNOME Keyring 存在时成功；无密钥服务时显示 `CREDENTIAL_UNAVAILABLE`）→ 跑通一个任务 | 手动 | **需要用户完成** |
| 真实 opencode 在 Windows / Linux 上的 `test:oc`、`test:live`、J10 | 在对应机器上运行 | **需要用户完成**（可选） |

按 D82，表中的三平台 CI 与 Windows / Linux 真机验证推迟到发布正式版本之前；在此之前以本机 macOS 的全量验证为准。

## 6. 不做

- 代码签名（Windows Authenticode、Linux 仓库签名）：没有证书，与 macOS 一致。
- 自动更新、Snap / Flatpak / rpm、Windows MSI 与 Microsoft Store。
- 在 Windows 上用 PowerShell 或 cmd 作为 AI 的 shell（§3.3）。

## 7. 发现但未处理

- `pnpm perf`（`playwright.perf.config.ts`，不进 CI）的启动命令用 `NODE_ENV=production …` 与 `:` 拼接 PATH，在 Windows 上不能运行；需要时改成与 `playwright.config.ts` 相同的写法。
- Windows runner 上建 worktree 偶有数秒（最大 9.3 s）的长尾，原因未查明（Defender 已排除）；真机上是否同样出现需要观察。

- macOS / Linux 上若用户在自己的 opencode 配置中把 `shell` 设为 PowerShell / nushell，只读规则同样不按 bash 语义匹配（v1.0 起的前提）。可选做法是三平台都注入 POSIX shell，但会失去 login shell 带来的 PATH，需要单独决定。
