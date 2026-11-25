import { FUNCTIONAL_TEST_NODE, type FunctionalTestNode } from '../../constants/functional-testing.ts';
import { McpToolName } from './names.ts';

const COMMON_TOOLS = [
  McpToolName.GetTaskContext,
  McpToolName.GetSubmissionGuide,
  McpToolName.GetNodeOutput,
  McpToolName.AskUser,
  McpToolName.SubmitResult,
  McpToolName.TestRunRead,
];

const SOURCE_TOOLS = [McpToolName.ReadAttachment, McpToolName.ReadSheet, McpToolName.ProcessDocument];
const PHASE_TOOLS: Record<FunctionalTestNode, McpToolName[]> = {
  [FUNCTIONAL_TEST_NODE.Author]: [
    ...SOURCE_TOOLS,
    McpToolName.Recall,
    McpToolName.ReadOfficeFile,
    McpToolName.TestCaseSave,
  ],
  [FUNCTIONAL_TEST_NODE.Import]: [...SOURCE_TOOLS, McpToolName.TestCaseSave],
  [FUNCTIONAL_TEST_NODE.Environment]: [
    McpToolName.Recall,
    McpToolName.TestIdeConfigurations,
    McpToolName.TestEnvironmentPrepare,
  ],
  [FUNCTIONAL_TEST_NODE.Execute]: [
    ...SOURCE_TOOLS,
    McpToolName.TestEnvironmentPrepare,
    McpToolName.TestCaseRun,
    McpToolName.DbListConnections,
    McpToolName.DbDescribe,
    McpToolName.DbQuery,
    McpToolName.InvestigateDatabase,
    McpToolName.TestCaseRevise,
    McpToolName.AnalyzeImage,
  ],
  [FUNCTIONAL_TEST_NODE.Report]: [McpToolName.TestReportSubmit],
};

export function functionalTestTools(node: FunctionalTestNode): McpToolName[] {
  return [...COMMON_TOOLS, ...PHASE_TOOLS[node]];
}
