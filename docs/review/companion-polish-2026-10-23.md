# 桌宠首轮试用修复 · 2026-10-23

基线 `main@7fb6a7a`（PR #56），分支 `codex/companion-polish`。本次修复用户安装后报告的三个交互问题，并重新设计默认光球。保留鲸鱼形象、现有对话、碎碎念及任务提醒；原创小人仍按 32 的 W6 后续制作。

## 缺陷与证据

| 问题 | 修复前可失败的复现 | 根因与修复 |
| --- | --- | --- |
| 角色受上方透明区域限制 | Electron 把角色拖到工作区左上 +8px，实际位置为 x=268、y=485，目标 x=8、y=41 | 旧 460×680 窗口整体被夹在工作区，角色又固定在右下。现在持久化角色锚点；收起时窗口只包角色及光晕绘制余量，展开面板自动选择方向。原生窗口保持在工作区，角色允许局部越界，至少保留 64px 可拖回。展开不改变角色尺寸。 |
| 开启桌宠后 Dock 消失、无法恢复主窗 | Electron 中 `app.dock.isVisible()` 为 false；关闭主窗后触发 activate，主窗仍隐藏 | 跨桌面显示默认转换整个应用的进程类型。设置 `skipTransformProcessType: true`，并处理 app activate 以恢复／聚焦主窗。 |
| 设置页底部往回滚出现大块空白 | 1280×800 页面，根文档 scrollHeight=2863，整页 scrollY=2063，顶栏离开视口 | 无障碍用的绝对定位 legend 没有内容区定位祖先，越过滚动容器撑高根文档。为内容区建立定位边界。回归等待滚轮真正改变滚动位置，再检查顶栏、根文档高度和截图。 |

初始失败日志：`/tmp/aw-polish-native-red.log`、`/tmp/aw-polish-scroll-red.log`。修复后定向验证：`/tmp/aw-polish-native-green.log`（3 个 Electron 用例）、`/tmp/aw-polish-browser-focused.log`（5 个浏览器用例）。几何边界 7 个单元测试覆盖四个方向、负坐标显示器、部分越界与小工作区。

Electron 的进程类型行为参见[官方 setVisibleOnAllWorkspaces 文档](https://www.electronjs.org/docs/latest/api/browser-window#winsetvisibleonallworkspacesvisible-options)。

## 极光视觉

内置 ImageGen 生成透明光带 PNG，提示词及素材说明保存在 `apps/web/public/companion/aurora/README.md`。大形象使用 WebGL 进行非均匀径向／角向变形、光带闪烁、色相漂移；不同动作调整节奏与色调。CSS 表达呼吸、工作环绕、完成庆祝等动作。纹理不来自鲸鱼项目。

渲染上限 30fps、720px，离屏／后台暂停；小图标不创建 WebGL 上下文。关闭动画和系统减少动态效果显示静态素材；GPU 上下文丢失后回退静态形象。浏览器验证已覆盖开启渲染、动画关闭、减少动态效果、上下文丢失、鲸鱼切换、任务通知、聊天与碎碎念。明暗截图：`screenshots/companion/orb-light.png`、`aurora-dark.png`。截图只用于人工走查，不作为像素断言。

## 验证与交付

- `pnpm verify` 最终退出 0：类型／lint／依赖／CSS／FSM 文档检查、711 个单元、306 个集成通过（1 个既有条件用例跳过）、生产构建通过。之后增加光晕绘制余量用例，全单元再次运行 712/712 通过，几何 7/7、桌宠原生回归 3/3 通过。
- 浏览器核心 45/45 通过，四主题全页走查 4/4 通过（包括可访问对比度与横向溢出检查）。
- `pnpm test:oc`：真实 opencode 协议 6/6 通过。
- `pnpm e2e:electron`：9/9 通过，包括真实模型任务执行中退出、重启继续完成；这是构建应用的旅程，安装包另做定向冒烟。
- 日志：`/tmp/aw-polish-verify-final.log`、`/tmp/aw-polish-unit-final.log`、`/tmp/aw-polish-browser-core-final.log`、`/tmp/aw-polish-e2e-all.log`（含四主题）、`/tmp/aw-polish-electron-all.log`、`/tmp/aw-polish-native-final.log`、`/tmp/aw-polish-oc.log`。

初轮全量失败均保留记录：滚动测试提前记录旧页面高度，改为判断实时剩余滚动距离；浏览器与 Electron 同时使用默认结果目录造成 trace 文件互相清理，后续使用独立目录重新跑完整核心序列；openGauss 容器在并发验证时启动等待超时，清理本次容器后全量 verify 通过。没有跳过失败用例、放宽时间限制或修改业务断言。

交付采用合并后的 main 打包，备份旧 `.app` 与用户数据后替换 `/Applications/Agent Workflow.app`；安装校验与回滚信息写入用户数据同级的 `Agent Workflow Backups`。本次不把多显示器真实拔插、Windows/Linux 或系统通知授权体验标记为已验证。
