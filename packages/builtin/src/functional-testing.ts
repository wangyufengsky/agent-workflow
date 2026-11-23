import { FUNCTIONAL_TEST_NODE, type WorkflowDefinition } from '@aw/shared';
import { BuiltinRoleKey } from './roles.ts';
import { SkillName } from './skills.ts';

const acceptance = { checks: [], manual: false };
const intro = `Read agent-workflow_get_task_context, then load ${SkillName.FunctionalTesting} with skill. Read agent-workflow_get_submission_guide for the phase contract.`;

function stage(key: string, title: string, roleKey: BuiltinRoleKey, dependsOn: string[], instruction: string) {
  return { key, title, roleKey, dependsOn, acceptance, instructions: `${intro}\n${instruction}` };
}

export function createFunctionalTestTemplate(importCases: boolean): NonNullable<WorkflowDefinition['template']> {
  const first = importCases
    ? stage(
        FUNCTIONAL_TEST_NODE.Import,
        '解析上传案例',
        BuiltinRoleKey.DocumentProcessor,
        [],
        'Read every designated case attachment through read_attachment or read_sheet. Save each case and its original location with test_case_save as soon as it is mapped. Read saved cases before resuming so you can continue from the last source location. Include each file’s counts, ambiguities and skipped regions in submit_result.',
      )
    : stage(
        FUNCTIONAL_TEST_NODE.Author,
        '编写案例',
        BuiltinRoleKey.Tester,
        [],
        'Design independent cases covering the requested behavior. Cite the requirement or contract for every assertion. Use test_case_save as each case is written, then use submit_result to hand over the planned coverage and remaining questions.',
      );
  return {
    nodes: [
      first,
      stage(
        FUNCTIONAL_TEST_NODE.Environment,
        '准备环境',
        BuiltinRoleKey.Tester,
        [first.key],
        'Use test_run_read first to inspect each saved case’s requires keys and any inheritedChecks. Use the configured local service or the approved complete URL. If no local startup is configured, or this task explicitly selects a different module/test profile, inspect its README, manifests and test configuration in the worktree and pass an evidence-backed launch to test_environment_prepare. Follow the Prepare instructions in the skill. Use the exact prerequisite keys. A linked retest reapplies its inherited probe definitions and records new observations. Compare environment.checks with the required keys, then submit the tested version, run ID and actual readiness. Report missing or failed prerequisites and continue with independent cases.',
      ),
      stage(
        FUNCTIONAL_TEST_NODE.Execute,
        '执行测试',
        BuiltinRoleKey.Tester,
        [FUNCTIONAL_TEST_NODE.Environment],
        'Use test_run_read to check preserved case versions and executions before starting or resuming. Use test_case_run for each executable case. Keep product failures, revise a case only with independent evidence via test_case_revise, and retain the original execution. Continue with independent cases, then submit_result.',
      ),
      stage(
        FUNCTIONAL_TEST_NODE.Report,
        '测试报告',
        BuiltinRoleKey.DocumentProcessor,
        [FUNCTIONAL_TEST_NODE.Execute],
        'Read the execution records with test_run_read. Submit the run and execution references, defect observations and coverage gaps with test_report_submit. Use the generated report result for submit_result. The saved execution records determine counts and verdicts.',
      ),
    ],
  };
}
