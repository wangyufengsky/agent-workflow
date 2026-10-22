# 21 · PR 审查意见回流（v1.2）

任务的结果已经以 GitHub PR / GitLab MR 交付后，同事在平台上留下审查意见。用户在应用里把这些意见取回来，勾选要处理的，点一下「让 AI 按意见再改改」：AI 在任务原来的分支上修改，用户看过改动后点「推送到 PR」，修改推送回同一个 PR/MR。合并始终由用户在平台上完成（D16）。

决策：D87（取回与勾选）、D88（修改后的推送）、D89（不回写平台），均按保守方案实现，用户 2026-10-22 确认。任务拆分见 [05 · v1.2 PR 审查意见回流](05-dev-plan.md#v12--pr-审查意见回流)。

## 1. 现状与边界

- 创建 PR 的交付（11 §5.3、09 §7）：推送任务分支 → 建 PR → 任务 `completed`，delivery 记录 `prUrl`；**worktree 删除、本地分支保留**（`delivery.deleteBranchAfterMerge` 只作用于本地合并）。
- 所以回流要做的事：确认 PR 仍然打开 → 取回意见 → 用保留的分支**重建 worktree** → 复用「让 AI 再改改」的节点机制追加一个修改节点 → 任务回到 `running` → 完成后回到 `review` → 用户推送回同一个 PR。
- 只处理本应用创建 PR 的任务（最近一次成功的交付是 `pull_request`）。不支持「导入任意 PR」。
- 不自动合并、不自动关闭 PR，不在平台上写任何东西（D89）。

## 2. 取回意见

### 2.1 何时取回：手动刷新（D87）

任务页结果卡的「审查意见」区有「取回审查意见」按钮，点击时实时向平台请求；不轮询、不在后台定时拉取，也不存库（每次取回都是平台上的最新状态）。

理由：

1. 审查意见是用户主动来处理的事（看到平台通知、同事告知），而不是需要应用推送的事件；手动刷新正好对应「我现在要处理它」。
2. 轮询要为每个打开 PR 的任务定期调用平台 API：令牌有速率限制（GitHub 每小时 5000 次），应用关着时轮询也没有意义；还要额外设计「新意见」提醒与已读状态。
3. 不存库就没有本地副本与平台不一致的问题（意见被编辑、删除、解决）。

### 2.2 取回什么

先按任务分支查找**打开着的** PR/MR（GitHub `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`，GitLab `GET /projects/:id/merge_requests?source_branch={branch}&state=opened`）。PR 已合并或关闭 → 409 `PULL_REQUEST_NOT_OPEN`，界面提示「PR 已合并或关闭」。

| 平台 | 未解决的审查讨论（`thread`） | 一般评论（`general`） |
| --- | --- | --- |
| GitHub | GraphQL `pullRequest.reviewThreads`：`isResolved = false` 的讨论，含文件、行、全部回复 | `pullRequest.comments`（对话区评论）与 `pullRequest.reviews` 中正文非空的审查总结 |
| GitLab | REST `GET /projects/:id/merge_requests/:iid/discussions`：含 `resolvable` 且未 `resolved` 的笔记的讨论 | 同一接口中 `individual_note` 且非系统笔记的讨论 |

- GitHub 用 GraphQL 而不是 REST：REST 的审查评论接口没有「是否已解决」，只有 GraphQL 有。仍经 Octokit（`octokit.graphql`，同一令牌与地址），不新增依赖。
- 已解决的讨论、系统笔记（GitLab 的「推送了 1 个提交」之类）、空正文不列出。
- 每类最多取前 100 条（GitHub 每个讨论最多 50 条回复）；一个 PR 上超过 100 条未解决讨论时只显示前 100 条，界面不分页（YAGNI）。
- 返回 `ReviewCommentsDTO`（11 §5.4）：PR 地址与编号，以及条目列表；每个条目有平台上的 id、类型、文件与行（一般评论为空）、平台链接、按时间排列的发言（作者、正文、时间），以及 `selectedByDefault`。

### 2.3 默认勾选（D87）

- 未解决的审查讨论：**全部默认勾选**。
- 一般评论没有「已解决」状态：只有**上次推送之后**的才默认勾选（上次推送 = 最近一次成功的 PR 交付的完成时间），之前的默认不勾——它们多半已在上一轮处理过，或是 CI 机器人的评论。
- 用户可以任意勾选、取消；至少勾选一条才能发起修改。另有一个可选的「补充说明」输入框，与勾选的意见一起交给 AI。

## 3. 发起修改

`POST /tasks/:id/review-feedback` `{ commentIds: string[], note?: string }`（操作 `tasks.reviseFromReview`，write）。后端按顺序：

1. 状态机检查 `completed --review_feedback--> running` 是否允许（只经状态机，09 §2）；最近一次成功的交付必须是 `pull_request`，否则 409 `PULL_REQUEST_NOT_OPEN`。
2. 项目必须仍绑定远端（否则 400 `HOSTING_NOT_CONFIGURED`）；按分支找到打开的 PR（否则 409 `PULL_REQUEST_NOT_OPEN`）。
3. **重新取回**意见，按 `commentIds` 挑出条目（前端传 id 而不是正文：AI 读到的一定是平台上的原文）；有 id 已不存在（被删除或已解决）→ 400 `VALIDATION_FAILED`（`issues[].path = ['commentIds']`），界面提示刷新后重选。
4. **同步分支**（§4.1）并**重建 worktree**（§4.2）。
5. 一个事务内：新计划版本（`source = user`、立即确认）+ 追加节点「按审查意见修改」+ 任务 `completed → running`（事件 `review_feedback`，`finishedAt` 清空）。之后由调度器照常派发。

### 3.1 复用「让 AI 再改改」的节点机制

与 13 §4 的系统节点相同：新节点依赖当前所有叶子节点，`kind = revise`，验收为项目检查命令（任务开启 `accept_each_node` 时另加人工验收）。

| 来源 | key | 标题 | 角色 | 指令模板 |
| --- | --- | --- | --- | --- |
| 按审查意见修改 | `review_fix_<n>` | 按审查意见修改 | developer | `revise-review.md`：PR 地址、勾选的意见（文件与行、每条发言的作者与正文）、用户的补充说明、当前结果摘要 |

- `ChangeRequestReason` 新增 `review`，`SYSTEM_NODES` 增加一项；`request-changes` 接口的 `reason` 仍只接受 `user` / `conflict`（`review` 只能经本接口发起，因为它需要取回意见）。
- 计划新版本的 `feedback` 为渲染后的意见文本（模型经 `get_task_context.userFeedback` 也能读到）。
- 节点完成 → `all_nodes_finished` → `review`，生成新的结果摘要与交付条目，与其他修改轮次完全一致。

## 4. 分支与 worktree

### 4.1 同步分支

审查者可能在平台上直接提交了建议（GitHub「Commit suggestion」、GitLab「Apply suggestion」），远端分支会比本地多出提交。修改前在仓库锁内：

1. `git fetch origin refs/heads/<branch>`（HTTPS 远端同推送一样经环境变量带令牌，09 §7）。
2. 本地分支不存在（被用户删掉）→ 从远端的提交重建；与远端相同或落后于远端 → 快进到远端；领先远端（上次推送失败）→ 保持；**两边分叉** → 409 `BRANCH_DIVERGED`，不做任何改动（不 rebase、不 merge、不覆盖，由用户在 Git 管理台处理）。

### 4.2 重建 worktree

任务只有一条 worktree 记录（10 §worktrees，`task_id` 唯一）。worktree 状态机新增事件 `restore`：`removed → creating`，复用原记录的路径与分支，`git worktree add <path> <branch>`（已有分支，不用 `-b`），成功 `created → ready`，失败 `create_failed → error` 并返回 `WORKTREE_CREATE_FAILED`（任务仍为 `completed`）。

worktree 的 `baseCommit` 不变；任务 diff 照旧相对 merge-base(目标分支, HEAD)，所以结果卡显示的是整个 PR 的改动。

## 5. 推送回同一个 PR（D88）

AI 改完后任务回到 `review`，**不自动推送**：用户在结果卡看过改动，点「推送到 PR」。

- 任务 DTO 新增 `pullRequest: { url, pushedAt } | null`：最近一次成功的 PR 交付（跨轮次，不同于只描述本轮的 `lastDelivery`）。
- 有 `pullRequest` 的任务在 `review` 时，结果卡的主按钮是「推送到 PR」（`deliver`，`strategy = pull_request`），不再显示「创建 PR」「合并到 main」与「合并选项…」（PR 交付的任务在平台上合并）；「让 AI 再改改…」与「放弃」照常。
- `pull_request` 交付在推送后先按分支查找打开的 PR：找到就沿用（不再新建，不改标题与说明），记录同一个 `prUrl`；没有才新建。所以第一次创建与后续推送是同一个操作，也不会因为「PR 已存在」而失败。
- 推送一律普通推送（`refs/heads/<b>:refs/heads/<b>`，不带 `--force`）。远端在修改期间又有新提交时推送被拒，交付失败（`GIT_COMMAND_FAILED`，任务回 `review`，结果卡显示原因）。
- 推送成功 → 任务 `completed`、worktree 删除（同第一次创建 PR）。再有意见时重复本流程。

## 6. 不回写平台（D89）

改完推送后，不在平台上回复评论、不把讨论标记为已解决。用户在平台上自己回复或解决（审查者通常希望自己确认后再解决）。

理由：回复与解决是对外可见、代表用户发言的动作；令牌的写权限也可能只开了推送。若用户希望自动回复（如「已在 abc1234 中修改」）或自动解决，再作为可选设置加入。

## 7. 状态机变化（09）

| 状态机 | 变化 |
| --- | --- |
| 任务 | 新事件 `review_feedback`：`completed → running`，声明为 `reopenedBy`：`completed` 仍是终态（活动任务、批次进度、「取消」按钮等判断不变），只有 PR 交付且 PR 仍打开时经本流程回到 `running`（service 判断，状态机只校验是否允许） |
| worktree | 新事件 `restore`：`removed → creating`（同样声明为 `reopenedBy`） |
| delivery | 不变 |

任务回到 `running` 后的一切（调度、暂停、失败与重试、取消、再次交付）与普通修改轮次相同。取消这样的任务照常删除 worktree 与（默认）分支；平台上的 PR 不动。

## 8. 接口与操作

| 操作 | 方法与路径 | 风险 | 说明 |
| --- | --- | --- | --- |
| `tasks.reviewComments` | `GET /tasks/:id/review-comments` | read | 实时取回打开的 PR 上的意见（§2） |
| `tasks.reviseFromReview` | `POST /tasks/:id/review-feedback` | write | 按勾选的意见发起修改（§3）；与「让 AI 再改改」同级（不合并、不对外发言） |

两者 `expose.assistant = true`、`mode = simple`：用户可以对助手说「看看 PR 上的意见，让 AI 改一下」，助手先读意见、再经确认卡片发起修改。推送仍是 `tasks.deliver`（critical，每次确认）。

错误码（08）：`PULL_REQUEST_NOT_OPEN`（409）、`BRANCH_DIVERGED`（409），其余沿用 `HOSTING_*`、`VALIDATION_FAILED`、`WORKTREE_CREATE_FAILED`。

## 9. 界面（14 §3.5）

已完成且以 PR 交付的任务，结果卡在 PR 链接下方有「审查意见」区：

```
已创建 PR  打开 PR
审查意见                                         [取回审查意见]
 ☑ src/greet.ts 第 3 行 · alice：这里应该处理空名字          [在平台查看]
     bob：同意
 ☑ alice：请补一个测试
 ☐ ci-bot：Coverage 85%（上次推送之前）
 补充说明（可选）[                                   ]
                                       [让 AI 按意见再改改]
```

- 取回前只有按钮与一句说明「同事在 PR 上留下意见后，取回来让 AI 按意见修改」；没有意见时显示「PR 上暂时没有需要处理的意见」。
- 「让 AI 按意见再改改」至少勾选一条才可点击；成功后提示「AI 会按审查意见修改，改完后由你推送到 PR」。
- 任务回到待合并后，主按钮「推送到 PR」，下方一句「这个任务已经有 PR，看过改动后推送到同一个 PR。」与「打开 PR」链接；交付完成显示「已推送到 PR」。
- 文案在 `web/src/copy/delivery.ts`；不出现「thread」「discussion」「worktree」等内部词。
