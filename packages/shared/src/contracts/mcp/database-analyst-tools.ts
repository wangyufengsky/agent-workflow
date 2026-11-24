import { McpToolName } from './names.ts';

/** 专职数据库节点的工具范围，opencode 配置和 MCP 授权共用。 */
export const DATABASE_ANALYST_TOOLS: readonly McpToolName[] = [
  McpToolName.GetTaskContext,
  McpToolName.GetSubmissionGuide,
  McpToolName.DbListConnections,
  McpToolName.DbDescribe,
  McpToolName.DbQuery,
  McpToolName.InvestigateDatabase,
  McpToolName.ReadAttachment,
  McpToolName.AskUser,
  McpToolName.ReportProgress,
  McpToolName.SubmitResult,
];
