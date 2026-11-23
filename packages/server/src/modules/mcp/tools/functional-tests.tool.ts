import {
  AppError,
  AttemptKind,
  ErrorCode,
  functionalTestCaseSaveSchema,
  functionalTestCaseSchema,
  functionalTestExecutionSchema,
  functionalTestPrepareSchema,
  functionalTestReadSchema,
  functionalTestReportSchema,
  functionalTestReportSubmitSchema,
  functionalTestReviseSchema,
  functionalTestRevisionResultSchema,
  functionalTestRunInputSchema,
  functionalTestRunSchema,
  functionalTestSnapshotSchema,
  McpToolName,
} from '@aw/shared';
import type { FunctionalTestsService } from '../../functional-tests/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

const allowedKinds = [AttemptKind.Execute];

export function functionalTestMcpTools(service: FunctionalTestsService) {
  return [
    defineMcpTool({
      name: McpToolName.TestCaseSave,
      allowedKinds,
      input: functionalTestCaseSaveSchema,
      output: functionalTestCaseSchema,
      description:
        'Save one draft case. Provide its title, requirement and ordered HTTP or browser steps with evidence-backed assertions. For imported cases, provide source. Resend the existing ID to complete a draft. Use needsClarification for a missing expectation. Executed versions require test_case_revise.',
      handler: (input, { attempt }) => service.save(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.TestEnvironmentPrepare,
      allowedKinds,
      input: functionalTestPrepareSchema,
      output: functionalTestRunSchema,
      description:
        'Start the task project’s approved local service or connect to its approved test URL. Optionally supply checks {key,path,expectedStatus}; cases with matching requires keys depend on their result. Returns a run ID and readiness evidence. Record a failed probe as an environment blocker and continue to the report.',
      handler: (input, { attempt, signal }) => service.prepare(attempt, input, signal),
    }),
    defineMcpTool({
      name: McpToolName.TestCaseRun,
      allowedKinds,
      input: functionalTestRunInputSchema,
      output: functionalTestExecutionSchema,
      description:
        'Execute the saved case ID and version in this run. Supply a stable executionId for this attempt to prevent duplicate writes. Can refer to earlier zero-based HTTP steps using {{0.body.id}} in paths and JSON bodies. If the call is interrupted, read the execution before making another request.',
      handler: (input, { attempt, signal }) => service.execute(attempt, input, signal),
    }),
    defineMcpTool({
      name: McpToolName.TestCaseRevise,
      allowedKinds,
      input: functionalTestReviseSchema,
      output: functionalTestRevisionResultSchema,
      description:
        'Propose a new full case definition without altering old evidence. Supply caseId, version, triggering executionId, reason and independent basis. Set contractPath for a committed JSON OpenAPI 3 contract when it directly proves the correction. Pending proposals need user approval. Read the returned version before retesting.',
      handler: (input, { attempt }) => service.revise(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.TestRunRead,
      allowedKinds,
      input: functionalTestReadSchema,
      output: functionalTestSnapshotSchema,
      description:
        'Read the task’s persisted case versions, environments, executions, evidence and reports. Filter by runId, caseId, step or event sequence after to inspect exact evidence. Use before resuming an interrupted write.',
      handler: (input, { attempt }) => {
        if (attempt.taskId === null) throw new AppError(ErrorCode.McpToolNotAllowed);
        return service.read(attempt.taskId, input);
      },
    }),
    defineMcpTool({
      name: McpToolName.TestReportSubmit,
      allowedKinds,
      input: functionalTestReportSubmitSchema,
      output: functionalTestReportSchema,
      description:
        'Publish the report for a run using all finished execution IDs exactly once. Optional findings refer to those IDs, and uncovered items describe what remains outside the evidence. Test failures and blockers may both be published. Then use submit_result to complete the node.',
      handler: (input, { attempt }) => service.submitReport(attempt, input),
    }),
  ];
}
