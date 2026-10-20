import { ErrorCode } from '@aw/shared';

/** User-facing message per error code; M6-03 completes the table. Unknown codes show GENERIC + the code. */
export const ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.ValidationFailed]: '输入的内容不符合要求，请检查后重试。',
  [ErrorCode.Unauthorized]: '与后台的连接已失效，请重启应用。',
  [ErrorCode.InternalError]: '后台出现了意外错误，请重试；问题持续时查看日志。',
  [ErrorCode.NotFound]: '要找的内容不存在。',
  [ErrorCode.ProjectNotFound]: '这个项目不存在或已被删除。',
  [ErrorCode.ProjectPathNotGitRepo]: '所选目录不是 Git 仓库的根目录。请选择仓库的最上层目录（包含 .git 的目录）。',
  [ErrorCode.ProjectAlreadyExists]: '这个仓库已经添加过了。',
  [ErrorCode.GitNotInstalled]: '没有找到 Git，请先安装 Git。',
  [ErrorCode.GitCommandFailed]: 'Git 命令执行失败。',
  [ErrorCode.GitBaseBranchNotFound]: '找不到这个分支。仓库处于游离 HEAD 时，请先切换到一个分支。',
  [ErrorCode.CredentialUnavailable]: '系统钥匙串不可用，无法保存令牌或密码。',
  [ErrorCode.StateTransitionInvalid]: '任务的状态已经变了，刷新后再试。',
  [ErrorCode.ProjectHasActiveTasks]: '这个项目还有未结束的任务，先完成或取消它们。',
  [ErrorCode.WorktreeCreateFailed]: '没能建立独立工作区（Git 分支或目录可能已存在）。',
  [ErrorCode.WorkflowNotFound]: '这个流程不存在。',
  [ErrorCode.WorkflowReadonly]: '内置流程不能修改，可以复制后再改。',
  [ErrorCode.RoleReadonly]: '内置角色不能修改，可以复制后再改。',
  [ErrorCode.TaskNotFound]: '这个任务不存在或已被删除。',
  [ErrorCode.PlanVersionConflict]: '计划已经更新，请查看最新版本后再确认。',
  [ErrorCode.NodeNotFound]: '这个步骤不存在。',
  [ErrorCode.NodeAttemptsExhausted]: '有一个步骤多次尝试仍没有完成。',
  [ErrorCode.AttemptNoResult]: 'AI 停下来了，但没有给出结果。',
  [ErrorCode.AttemptTimeout]: 'AI 会话超过了时限。',
  [ErrorCode.AttemptSessionError]: 'AI 会话出错了（模型服务可能暂时不可用）。',
  [ErrorCode.OpencodeNotReady]: 'opencode 还没有就绪，请稍后再试。',
  [ErrorCode.OpencodeRequestFailed]: '与 opencode 通信失败。',
  [ErrorCode.InboxItemNotFound]: '这一项不存在。',
  [ErrorCode.InboxItemClosed]: '这一项已经处理过了。',
};

export const GENERIC_ERROR = '操作没有成功。';
