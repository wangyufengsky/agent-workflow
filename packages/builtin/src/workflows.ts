import {
  type Acceptance,
  AcceptanceCheckKind,
  PROJECT_CHECK_PLACEHOLDER,
  RequiredStepPosition,
  type WorkflowDefinition,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import { BuiltinRoleKey } from './roles.ts';

/** Built-in workflow (13 §3); an AI-planned workflow's planner guidance is `prompts/workflows/<key>.md`. */
export type BuiltinWorkflow = {
  key: string;
  name: string;
  description: string;
  planning: WorkflowPlanning;
  deliverable: WorkflowDeliverable;
  definition: Omit<WorkflowDefinition, 'plannerGuidance'>;
};

export const BuiltinWorkflowKey = {
  Feature: 'feature',
  Bugfix: 'bugfix',
  UnitTests: 'unit_tests',
  CodeReview: 'code_review',
  Refactor: 'refactor',
} as const;

const projectCheck = { kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER } as const;
const aiReview = (focus: string) => ({ kind: AcceptanceCheckKind.AiReview, focus }) as const;
const checked: Acceptance = { checks: [projectCheck], manual: false };
const unchecked: Acceptance = { checks: [], manual: false };
const noCheckpoints = { confirm_plan: false, accept_each_node: false };

const finalVerify = (instructions: string, focus: string) => ({
  key: 'final_verify',
  title: '整体验证',
  roleKey: BuiltinRoleKey.Tester,
  instructions,
  dependsOn: [],
  acceptance: { checks: [projectCheck, aiReview(focus)], manual: false },
  position: RequiredStepPosition.Last,
});

export const BUILTIN_WORKFLOWS: readonly BuiltinWorkflow[] = [
  {
    key: BuiltinWorkflowKey.Feature,
    name: '新功能开发',
    description: 'AI 读代码后拆分步骤，实现并测试一个新功能',
    planning: WorkflowPlanning.Ai,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer, BuiltinRoleKey.Tester],
      plannerRole: BuiltinRoleKey.Planner,
      requiredSteps: [
        finalVerify(
          '运行完整检查，修复本任务引入的失败，并逐条确认需求都已实现；发现遗漏时补上实现与测试。',
          '需求完整性与正确性',
        ),
      ],
      checkpoints: noCheckpoints,
      defaultAcceptance: checked,
    },
  },
  {
    key: BuiltinWorkflowKey.Bugfix,
    name: '修 Bug',
    description: '先写失败的测试复现问题并找到根因，再修复根因',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer],
      template: {
        nodes: [
          {
            key: 'locate',
            title: '定位根因',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '复现问题：写一个能稳定复现该问题的失败测试，并在 notes 中写明根因与证据（相关代码位置、触发条件）。这一步不修复问题。',
            dependsOn: [],
            acceptance: unchecked,
          },
          {
            key: 'fix',
            title: '修复',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '按上一步找到的根因修复问题（修根因，不是掩盖症状，不加兜底逻辑），让复现测试通过，且不破坏其他测试。',
            dependsOn: ['locate'],
            acceptance: {
              checks: [projectCheck, aiReview('是否修复了根因而非绕过症状，是否引入了兜底逻辑')],
              manual: false,
            },
          },
        ],
      },
      checkpoints: noCheckpoints,
      defaultAcceptance: checked,
    },
  },
  {
    key: BuiltinWorkflowKey.UnitTests,
    name: '补单元测试',
    description: '找出缺少测试的关键行为，补上验证行为的测试',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Tester],
      template: {
        nodes: [
          {
            key: 'analyze',
            title: '分析测试缺口',
            roleKey: BuiltinRoleKey.Tester,
            instructions:
              '按需求描述的范围找出缺少测试的关键行为，在 summary 中列出清单（行为、所在位置、建议的测试层次）。这一步不写代码。',
            dependsOn: [],
            acceptance: unchecked,
          },
          {
            key: 'write_tests',
            title: '编写测试',
            roleKey: BuiltinRoleKey.Tester,
            instructions:
              '按上一步的清单编写测试：断言外部可观察的行为，不测实现细节，不写冗余测试。发现被测代码的缺陷时不要修改其行为，写进 notes。',
            dependsOn: ['analyze'],
            acceptance: {
              checks: [projectCheck, aiReview('测试是否断言了真实行为，是否有冗余或脆弱的测试')],
              manual: false,
            },
          },
        ],
      },
      checkpoints: noCheckpoints,
      defaultAcceptance: checked,
    },
  },
  {
    key: BuiltinWorkflowKey.CodeReview,
    name: '代码审查',
    description: '只读审查指定范围的代码，产出问题清单，不改代码',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.Report,
    definition: {
      allowedRoles: [BuiltinRoleKey.Reviewer],
      template: {
        nodes: [
          {
            key: 'review',
            title: '代码审查',
            roleKey: BuiltinRoleKey.Reviewer,
            instructions:
              '按需求描述的范围（分支、提交区间或目录）审查代码，在 summary 中产出问题清单：每条写明严重程度（blocker / major / minor）、位置、说明与修改建议。只报真实问题，不提风格偏好。',
            dependsOn: [],
            acceptance: unchecked,
          },
        ],
      },
      checkpoints: noCheckpoints,
      defaultAcceptance: unchecked,
    },
  },
  {
    key: BuiltinWorkflowKey.Refactor,
    name: '重构',
    description: '保持外部行为不变，分小步改善代码结构',
    planning: WorkflowPlanning.Ai,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer, BuiltinRoleKey.Tester],
      plannerRole: BuiltinRoleKey.Planner,
      requiredSteps: [
        {
          key: 'baseline',
          title: '建立基线',
          roleKey: BuiltinRoleKey.Tester,
          instructions:
            '运行现有测试并在 summary 中记录结果；若重构范围缺少测试覆盖，先补特征测试（固定当前外部行为的测试），确保它们在重构前通过。',
          dependsOn: [],
          acceptance: unchecked,
          position: RequiredStepPosition.First,
        },
        finalVerify('运行完整检查，确认所有测试通过、外部行为没有改变；修复本任务引入的失败。', '外部行为是否保持不变'),
      ],
      checkpoints: noCheckpoints,
      defaultAcceptance: checked,
    },
  },
];
