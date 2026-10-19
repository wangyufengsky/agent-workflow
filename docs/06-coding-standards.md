# 06 · 代码开发规范

适用于所有人和 AI 编码助手。违反「必须」条目的 PR 不合并。

## 1. 核心原则

1. **找根因，不兜底。** 出现缺陷时先定位根因再修；禁止用默认值、`try/catch` 吞掉、加重试、加 `?.`、加 `setTimeout` 等方式让症状消失。修复缺陷的提交说明必须写「根因：…」。
2. **不过度防御。** 只在系统边界校验输入：HTTP 请求、MCP 工具参数、外部进程输出（git、opencode）、数据库 JSON 列、用户设置。边界以内信任类型系统，不重复校验、不为「不可能」的情况写分支。
3. **简单优先（YAGNI）。** 只实现当前需求；不为「将来可能」加参数、配置项、抽象层、插件点。接口只在 [03 §4.2](03-architecture.md#42-扩展点只在这些地方定义接口) 列出的扩展点定义。
4. **一处定义。** 枚举、常量、错误码、状态转换、默认设置、文案各自只有一个定义位置，其他地方引用。
5. **状态只能经状态机改变。** 不直接写 `status` 字段。
6. **让失败显性。** 失败就抛 `AppError(code)`，由统一出口转换为 HTTP / MCP 错误；不返回 `null` / `false` 表示失败，不返回「部分成功」。

## 2. 防御与错误处理

### 2.1 什么时候可以 catch

只有以下三种情况允许 `try/catch`：

| 场景 | 做法 |
| --- | --- |
| **翻译**：外部错误转为领域错误 | `catch (e) { throw new AppError(ErrorCode.GitCommandFailed, undefined, { args, stderr }) }` |
| **清理**：资源释放后继续抛出 | `finally` 或 catch 后 `throw e` |
| **有意义的恢复**：业务上明确定义的替代路径 | 例如 `git merge` 冲突 → `git merge --abort` → 抛 `DELIVERY_CONFLICT`。必须有测试覆盖该路径 |

禁止：

```ts
// ✗ 吞掉错误
try { await worktrees.remove(id) } catch {}

// ✗ 兜底默认值掩盖缺陷
const role = roles.find(r => r.key === key) ?? roles[0];

// ✗ 「以防万一」的可选链
const name = task?.project?.name ?? '未知项目';   // task 与 project 在类型上不可空

// ✗ 用重试掩盖竞态
for (let i = 0; i < 3; i++) { try { return await gitAddWorktree() } catch { await sleep(500) } }
```

正确：

```ts
const role = roles.find(r => r.key === key);
if (!role) throw new AppError(ErrorCode.RoleNotFound, undefined, { key });   // 这是真实可能（用户输入）的情况

// 竞态的根因是同仓库并发改 refs → 用每仓库互斥锁串行化
await repoLock.run(project.repoPath, () => git.worktreeAdd(...));
```

### 2.2 校验

- 边界校验统一用 zod schema（来自 `shared/contracts`），失败抛 `VALIDATION_FAILED`。
- 内部函数参数不重复校验；类型能表达的约束用类型表达（字面量联合、品牌类型如 `TaskId`）。
- 断言「不可能」的分支用 `assertNever(x)`（穷尽检查），不写注释「不会发生」后静默返回。

### 2.3 外部进程与 IO

- 所有 git 调用经 `modules/git/git.cli.ts` 的 `runGit(args, { cwd })`，固定 `LC_ALL=C`，失败统一抛 `GIT_COMMAND_FAILED`，携带 args、exitCode、stderr；改动 refs 或 worktree 列表的调用经每仓库互斥锁（D37）。
- 不解析人类可读输出；用 `--porcelain`、`--format`、`-z` 等机器格式。
- opencode 接口只经 `modules/opencode/client` 调用，其他模块不直接 import SDK。

## 3. 枚举、常量与配置

- 枚举写法见 [08 §1](08-enums-and-errors.md#1-写法约定)；禁止 TS `enum`、禁止裸字符串比较状态。
- 魔法数字/字符串进 `shared/constants`；仅在一个函数内使用且语义自明的字面量（如数组下标 0、`'utf8'`）除外。
- 用户可见文案只在 `web/src/copy/`；后端错误 `message` 为英文开发者信息，不给用户看。
- 新增设置项：在 `shared/constants/settings.ts` 加键、默认值、schema 和所属模式；同时更新 08 §4.3。

## 4. 模块与分层

- 依赖方向见 [03 §4.1](03-architecture.md#41-后端模块约定)，由 dependency-cruiser 强制。
- 对外功能操作一律通过操作清单注册（[03 §5](03-architecture.md#5-操作清单operation-registry)），不手写 route；operation handler 与 route 只做：解析 → 调 service → 返回 DTO，不写业务判断。
- 每个操作必须正确标注 `risk`（read / write / critical）与 `credentialFields`；这决定 v1.1 助手的确认与凭据隔离，标错视为安全缺陷。
- service 持有业务规则与事务边界；跨实体状态变更在一个事务内完成。
- repo 只做数据存取，不含业务判断；返回领域对象，不泄漏 Drizzle 行类型到 service 之外。
- 执行 MCP 工具 handler 同样只转发到 service，与操作共用业务逻辑。
- 服务实例通过模块 `index.ts` 的工厂函数显式组装（`createServices(deps)`），不使用 IoC 容器和全局单例。
- 前端：服务端数据只在 TanStack Query 中；Zustand 只放纯界面状态（选中节点、面板开合）；不把服务端数据复制进 Zustand。

## 5. TypeScript

- `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 开启。
- 禁止 `any`；外部未知数据用 `unknown` + zod 解析。
- 禁止非空断言 `!`，除非紧邻一行注释说明为何类型系统无法表达且确实不可能为空。
- 禁止 `as` 类型断言绕过检查（`as const` 除外；测试数据构造允许）。
- 只用具名导出；不用 `default export`（路由懒加载入口与工具配置文件除外）。
- 相对导入写显式扩展名 `./x.ts`（Biome `useImportExtensions`）；`erasableSyntaxOnly` 开启：不用 enum、参数属性（`constructor(readonly x)`）、namespace（D29）。
- 异步一律 `async/await`；不混用 `.then` 链；不留悬空 Promise（Biome `noFloatingPromises`）。

## 6. 命名与文件

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 文件 | kebab-case；后缀表明角色 | `task-detail.page.tsx`、`tasks.service.ts`、`submit-plan.tool.ts`、`task.machine.ts` |
| 类型 / 组件 | PascalCase | `TaskDetailDTO`、`ResultCard` |
| 函数 / 变量 | camelCase，动词开头的函数 | `createTask`、`resolveCheckpoints` |
| 常量 | UPPER_SNAKE | `PLAN_MAX_NODES` |
| 枚举对象 | PascalCase 对象 + 同名类型 | `TaskStatus.Running` |
| 布尔 | `is/has/can/should` 前缀 | `hasOpenQuestion` |
| 数据库列 | snake_case；TS 字段 camelCase | `failed_phase` ↔ `failedPhase` |

- 单文件建议 ≤ 300 行，单函数建议 ≤ 50 行；超过时按职责拆分，而不是按行数机械拆。
- 一个组件一个文件；样式 `*.module.css` 同目录。

## 7. 注释与文档

- 注释写「为什么」，不写「做了什么」。代码能说明的不写注释。
- 不留注释掉的代码、不留 `TODO` 不带任务编号（`// TODO(M5-02): …` 可以）。
- 不写 `// hack`、`// workaround` 掩盖问题；如确需临时绕过外部缺陷（如 opencode bug），注释写明外部问题链接与移除条件。
- 改枚举、状态机、API、MCP 工具、表结构时，同一提交更新 `docs/` 对应文档。

## 8. 前端

- 函数组件 + hooks；不用 class 组件。
- 不用 `useEffect` 计算派生数据；派生值直接在渲染中计算（必要时 `useMemo`）。
- 数据加载用 Query 的 `isPending/isError`；错误态显示统一的 `ErrorState`（按错误码查文案），不在每个组件自己 catch。
- 样式只用主题令牌 `var(--token)`；不写颜色字面量；间距与字号使用 `base.css` 中的尺度变量。
- 可访问：交互元素可键盘操作；图标按钮有 `aria-label`；对话框焦点限定与还原（Radix 已提供）。
- 画布节点组件保持纯展示，交互逻辑放画布容器。

## 9. 数据库

- 表结构变更只通过 drizzle-kit 生成新迁移；不修改已合并的迁移文件。
- 多行写入、状态转换 + 事件记录必须在同一事务中。
- 不在循环中逐条查询（N+1）；列表接口一次查询或批量查询。
- JSON 列读出后立即用 zod 解析为领域类型。

## 10. 日志

- pino 结构化日志：`log.info({ taskId, nodeId }, 'node dispatched')`。消息英文、小写开头、无句号。
- 级别：`error` 需要人处理的失败；`warn` 自动恢复的异常（如 opencode 自动重启）；`info` 状态转换与关键操作；`debug` 细节。
- 禁止记录：令牌、密码、凭据密文、完整提示词与模型正文（会话流在 JSONL 里，不进日志）。

## 11. 安全

- 凭据只经 credentials 模块读写；DTO 中只出现 `hasToken: boolean` 之类。
- 拼接 shell 命令一律用 execa 参数数组，禁止字符串拼接命令。
- 文件路径参数（来自用户或模型）必须解析为绝对路径并确认位于允许的根目录内。
- renderer 安全配置见 [03 §9](03-architecture.md#9-安全边界)，不得放宽。

## 12. 依赖

- 版本精确锁定（`"zod": "4.6.7"`）。
- 新增依赖需在 [03 §3](03-architecture.md#3-技术选型与依赖清单) 登记用途；能用标准库或已有依赖十几行实现的，不新增依赖。
- 升级 opencode 版本是独立任务：改 `OPENCODE_VERSION` 与 SDK 版本，跑 `@opencode` 集成测试与 live 测试。

## 13. Git 与评审

- 分支：`feat/M3-04-plan-submit`、`fix/<简述>`、`docs/<简述>`。
- 提交：Conventional Commits（`feat(plans): validate required step order`），一个提交一件事。
- PR：描述「做了什么、为什么、怎么验证」；缺陷修复写根因；关联任务编号；UI 改动附截图（至少一个暗色、一个亮色主题）。
- 评审清单：
  - [ ] 有没有 catch 吞错、默认值兜底、无必要的可选链与重试？
  - [ ] 状态是否只经状态机改变？
  - [ ] 有没有新的魔法值、裸字符串状态、裸中文文案？
  - [ ] 有没有为不存在的需求做的抽象或配置？
  - [ ] 测试是否符合 07 规范（不多、不少、不脆弱）？
  - [ ] 文档是否同步？

## 14. 给 AI 编码助手的额外要求

- 动手前读本规范、07 测试规范、以及与任务相关的 docs 章节。
- 不要为了让测试通过而修改断言或加特殊分支；测试失败先判断是代码错还是测试错，并说明理由。
- 不要「顺手」重构与任务无关的代码；发现问题记录在 PR 描述的「发现但未处理」中。
- 不确定需求时停下来问，不要猜测后用兜底逻辑覆盖多种可能。
