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
  ideConfigurationsSchema,
  McpToolName,
} from '@aw/shared';
import { z } from 'zod';
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
      name: McpToolName.TestIdeConfigurations,
      allowedKinds,
      input: z.object({}),
      output: ideConfigurationsSchema,
      description:
        'Discover IntelliJ IDEA Application and Spring Boot run configurations for this local test task, including the registered project’s unshared workspace configuration. Returns launch hints and unsupported option categories. Verify the intended main class and test environment in the worktree.',
      handler: (_, { attempt }) => service.ideConfigurations(attempt),
    }),
    defineMcpTool({
      name: McpToolName.TestEnvironmentPrepare,
      allowedKinds,
      input: functionalTestPrepareSchema,
      output: functionalTestRunSchema,
      description:
        'Start the authorized local service or connect to the approved test URL. For local discovery pass launch {directory,source,script,readyPath,profile?}. Both paths start at the worktree root: for module/src/Server.java set directory=module/src and source=module/src/Server.java; source is the module manifest or a standalone Java source. Use the existing Node service script, spring-boot:run, bootRun, or java-main. For java-main supply verified mainClass, optional javaVersion and Maven includeProvided; the service must honor PORT or the server.port JVM property. The optional test/qa profile must be backed by the Spring configuration or match the mode/environment in a Node script. The runner allocates PORT. Omit launch to reuse the project setting or recover this run. Never supply launch for an external URL. First read saved requires keys with test_run_read. Supply checks {key,path,expectedStatus} for documented prerequisites under their exact keys. On linked retests inheritedChecks are re-probed automatically and retain their definitions. Read the returned environment.checks to identify case blockers. Service readiness alone does not satisfy a required key.',
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
        'Propose a case correction without altering old evidence. Supply caseId, version, triggering executionId, reason and independent basis. For HTTP corrections use change { kind: rename_request_field, step, from, to } or { kind: correct_success_status, step, expected }; step is zero-based. Otherwise supply the exact saved definition minus id/version/number with only the intended edits. Set contractPath for the committed JSON OpenAPI 3 contract that proves the correction. A pending result leaves the current version unchanged until user approval.',
      handler: (input, { attempt }) => service.revise(attempt, input),
    }),
    defineMcpTool({
      name: McpToolName.TestRunRead,
      allowedKinds,
      input: functionalTestReadSchema,
      output: functionalTestSnapshotSchema,
      description:
        'Read saved case versions, prerequisite keys, environments, executions, evidence and reports. On linked retests, inheritedChecks contains original probe definitions without their old verdicts. Filter by runId, caseId, step or event sequence after to inspect exact evidence. Use before environment preparation or when resuming an interrupted write.',
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
