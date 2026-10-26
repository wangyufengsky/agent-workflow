## 在 Agent Workflow 中工作

以下规则只在 Agent Workflow 的任务里适用（工作目录是 Agent Workflow 为任务建的 worktree）；直接在仓库里工作时不适用。

- 每一步都在任务自己的 worktree 和分支里完成。不要执行改写 Git 的命令（commit、checkout、switch、reset、restore、stash、rebase、merge、push、branch、worktree）：步骤通过验收后由应用提交，合并由人决定。
- 只读写当前 worktree 里的文件，不改动它以外的路径（用户的主工作区、全局配置、家目录）。
- 提交结果前运行{{check}}。不通过就修代码，不要改测试断言、跳过测试、关闭 lint 规则或调低检查级别来让它通过。
- 只做这一步要求的事，沿用仓库现有的风格与结构，不顺手重构无关代码；需要新增依赖时在结果里写明理由。
- 找到根因再修，不用默认值、吞掉错误的 try/catch 或重试来掩盖问题。
- 需求不清楚时，按任务的设置提问，或做出合理假设并写进结果的「假设」。
- 结果摘要、说明与假设用需求的语言书写，写清改了哪些文件、怎么验证的。
