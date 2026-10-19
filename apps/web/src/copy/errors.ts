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
};

export const GENERIC_ERROR = '操作没有成功。';
