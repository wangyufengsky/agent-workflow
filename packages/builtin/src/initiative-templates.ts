import { INITIATIVE_BACKGROUND_NAME, type InitiativeDraft } from '@aw/shared';
import { BuiltinWorkflowKey } from './workflows.ts';

/** A built-in composition template (34 §15.3); requirements are written for the model, in Chinese like step instructions. */
export type BuiltinInitiativeTemplate = InitiativeDraft & { key: string; name: string; description: string };

export const BuiltinInitiativeTemplateKey = {
  DesignThenBuild: 'design_then_build',
  DetailedDesignThenBuild: 'detailed_design_then_build',
  BuildThenReview: 'build_then_review',
  TestsThenRefactor: 'tests_then_refactor',
} as const;

const R = '{{requirement}}';
const background = `背景资料「${INITIATIVE_BACKGROUND_NAME}」`;
const item = (
  key: string,
  title: string,
  phase: number,
  workflow: string,
  requirement: string,
  dependsOn: string[] = [],
) => ({ key, title, phase, workflow, requirement, dependsOn, acceptance: [] });

export const BUILTIN_INITIATIVE_TEMPLATES: readonly BuiltinInitiativeTemplate[] = [
  {
    key: BuiltinInitiativeTemplateKey.DesignThenBuild,
    name: '设计后开发',
    description: '先出几种方案并推荐一种，你看过报告后按推荐方案开发',
    phases: [
      { title: '方案设计', goal: '读代码后给出可行方案与推荐', autoOpen: false },
      { title: '开发', goal: '按推荐方案实现需求', autoOpen: true },
    ],
    items: [
      item('design', '方案设计', 1, BuiltinWorkflowKey.DesignProposal, R),
      item(
        'build',
        '按方案开发',
        2,
        BuiltinWorkflowKey.Feature,
        `${R}\n\n按${background}中「方案设计」的推荐方案实施；与方案不一致的地方写进假设。`,
        ['design'],
      ),
    ],
  },
  {
    key: BuiltinInitiativeTemplateKey.DetailedDesignThenBuild,
    name: '详细设计后开发',
    description: '先写一份详细设计文档并合入仓库，再照着文档开发',
    phases: [
      { title: '详细设计', goal: '写出能照着开发的设计文档并合入', autoOpen: false },
      { title: '开发', goal: '按设计文档实现需求', autoOpen: true },
    ],
    items: [
      item('design', '详细设计', 1, BuiltinWorkflowKey.DetailedDesign, R),
      item(
        'build',
        '按设计开发',
        2,
        BuiltinWorkflowKey.Feature,
        `${R}\n\n按已合入仓库的详细设计文档实施，文档路径见${background}中「详细设计」的改动文件。`,
        ['design'],
      ),
    ],
  },
  {
    key: BuiltinInitiativeTemplateKey.BuildThenReview,
    name: '开发后审查',
    description: '开发并合入后，同时做代码审查与安全审查',
    phases: [
      { title: '开发', goal: '实现需求并合入', autoOpen: false },
      { title: '审查', goal: '审查这次合入的改动', autoOpen: true },
    ],
    items: [
      item('build', '开发', 1, BuiltinWorkflowKey.Feature, R),
      item(
        'review',
        '代码审查',
        2,
        BuiltinWorkflowKey.CodeReview,
        `审查上一阶段为下面这个需求合入的改动（合入提交见${background}），只报这次改动引入的问题。\n\n${R}`,
        ['build'],
      ),
      item(
        'security',
        '安全审查',
        2,
        BuiltinWorkflowKey.SecurityReview,
        `只对上一阶段为下面这个需求合入的改动做安全审查（合入提交与改动文件见${background}）。\n\n${R}`,
        ['build'],
      ),
    ],
  },
  {
    key: BuiltinInitiativeTemplateKey.TestsThenRefactor,
    name: '先补测试再重构',
    description: '先给要重构的代码补上测试作为安全网，再重构',
    phases: [
      { title: '补测试', goal: '固定现有行为', autoOpen: false },
      { title: '重构', goal: '外部行为不变地改善结构', autoOpen: true },
    ],
    items: [
      item(
        'tests',
        '补单元测试',
        1,
        BuiltinWorkflowKey.UnitTests,
        `为下面这次重构涉及的代码补单元测试，固定它现在的行为，作为重构的安全网。\n\n${R}`,
      ),
      item(
        'refactor',
        '重构',
        2,
        BuiltinWorkflowKey.Refactor,
        `${R}\n\n上一阶段补上的测试是这次重构的安全网，重构后必须全部通过。`,
        ['tests'],
      ),
    ],
  },
];
