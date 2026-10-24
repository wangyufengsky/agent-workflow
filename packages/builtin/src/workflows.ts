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
  VersionReview: 'version_review',
  SecurityReview: 'security_review',
  Cleanup: 'cleanup',
  DesignProposal: 'design_proposal',
  DetailedDesign: 'detailed_design',
} as const;

const projectCheck = { kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER } as const;
const aiReview = (focus: string) => ({ kind: AcceptanceCheckKind.AiReview, focus }) as const;
/** The project's key pages at the default viewports; dropped when the project has no preview (29 §7.1). */
const pageCheck = { kind: AcceptanceCheckKind.Browser } as const;
const checked: Acceptance = { checks: [projectCheck], manual: false };
const unchecked: Acceptance = { checks: [], manual: false };
const noCheckpoints = { confirm_plan: false, accept_each_node: false };

const finalVerify = (instructions: string, focus: string) => ({
  key: 'final_verify',
  title: '整体验证',
  roleKey: BuiltinRoleKey.Developer,
  instructions,
  dependsOn: [],
  acceptance: { checks: [projectCheck, pageCheck, aiReview(focus)], manual: false },
  position: RequiredStepPosition.Last,
});

/** A read-only workflow of one reviewer step whose report is the task's result. */
const reportOnly = (key: string, title: string, instructions: string) => ({
  allowedRoles: [BuiltinRoleKey.Reviewer],
  template: {
    nodes: [{ key, title, roleKey: BuiltinRoleKey.Reviewer, instructions, dependsOn: [], acceptance: unchecked }],
  },
  checkpoints: noCheckpoints,
  defaultAcceptance: unchecked,
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
              checks: [projectCheck, pageCheck, aiReview('是否修复了根因而非绕过症状，是否引入了兜底逻辑')],
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
    definition: reportOnly(
      'review',
      '代码审查',
      '按需求描述的范围（分支、提交区间或目录）审查代码，在 summary 中产出问题清单：每条写明严重程度（blocker / major / minor）、位置、说明与修改建议。只报真实问题，不提风格偏好。',
    ),
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
  {
    key: BuiltinWorkflowKey.VersionReview,
    name: '版本比对审查',
    description: '对比当前版本与指定日期或提交时的版本，只审查这段时间新增与修改的代码',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.Report,
    definition: reportOnly(
      'review',
      '版本比对审查',
      [
        '对比任务基础分支的当前版本（HEAD）与需求中指定的起点，只审查这段时间新增与修改的代码。',
        '1. 确定起点：需求写的是日期时，用 `git log --first-parent --before="<日期> 00:00" -1 --format=%H HEAD` 找到那天开始前的最后一个提交；写的是提交、标签或分支时直接用它。',
        '2. 用 `git diff --stat <起点> HEAD` 与 `git diff <起点> HEAD` 阅读改动，用 `git log --first-parent --format="%h %ad %s" --date=short <起点>..HEAD` 了解每次改动的目的（提交数也从这里数），需要时读改动周围的代码。',
        '只用 `git log`、`git diff`、`git show` 与读文件，一次运行一条命令，不用管道串联；其他 git 命令会打断用户请求许可。',
        '3. 在 summary 开头写明比对范围：起点（提交、日期、标题）、终点（HEAD）、提交数与改动文件数；然后产出问题清单，每条写明严重程度（blocker / major / minor）、位置（文件与行）、说明与修改建议。',
        '只报这段时间引入的真实问题，起点之前就存在的问题不报，不提风格偏好。',
      ].join('\n'),
    ),
  },
  {
    key: BuiltinWorkflowKey.SecurityReview,
    name: '安全审查',
    description: '只读检查代码中的安全隐患，产出有依据的问题清单，不改代码',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.Report,
    definition: reportOnly(
      'review',
      '安全审查',
      [
        '按需求描述的范围（没写时为整个仓库）审查安全问题：',
        '- 注入：SQL、命令、路径穿越、模板与 HTML（XSS）；',
        '- 认证与授权：缺少登录校验、越权访问他人数据、会话与令牌处理不当；',
        '- 敏感信息：硬编码的密码与密钥、写进日志或返回给前端的敏感数据、提交进仓库的配置；',
        '- 输入与数据：缺少校验、不安全的反序列化与文件上传、加密与随机数用法不当；',
        '- 依赖与配置：依赖清单与锁文件中明显过时且有已知漏洞的版本、不安全的默认配置（如调试模式、宽松的跨域）。',
        '在 summary 中产出问题清单，每条写明严重程度（blocker / major / minor）、位置（文件与行）、可被利用的方式与修改建议。只报有代码依据的真实问题，不报纯理论风险；不联网，不安装或运行扫描工具。',
      ].join('\n'),
    ),
  },
  {
    key: BuiltinWorkflowKey.Cleanup,
    name: '清理告警',
    description: '修掉 lint 与编译告警、删除未使用的代码，外部行为不变',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer],
      template: {
        nodes: [
          {
            key: 'inventory',
            title: '列出告警',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '按需求描述的范围（没写时为整个仓库），运行项目已有的 lint、类型检查与构建，并查找未使用的代码（没有引用的函数、文件与依赖）。导出的函数、类与接口可能在仓库外使用（库的公开接口、入口、插件、配置或反射），不能确认只在仓库内使用时一律保留。在 summary 中列出清单：位置、类别、打算怎么处理（修改 / 删除 / 保留并说明原因）。这一步不改文件。',
            dependsOn: [],
            acceptance: unchecked,
          },
          {
            key: 'fix',
            title: '清理',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '按上一步的清单修掉告警、删除确认未使用的代码。只通过改代码消除告警：不关闭规则、不加忽略注释、不调低检查级别；确属误报的保留并在 notes 中说明。不改变外部行为，最后重新运行 lint 与检查确认告警已消除。',
            dependsOn: ['inventory'],
            acceptance: {
              checks: [
                projectCheck,
                pageCheck,
                aiReview('是否只做了清理而没有改变外部行为，是否用关闭规则或忽略注释掩盖告警'),
              ],
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
    key: BuiltinWorkflowKey.DesignProposal,
    name: '方案设计',
    description: '读代码后给出几种可行方案与取舍，推荐一种并列出实施步骤，不改代码',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.Report,
    definition: reportOnly(
      'design',
      '方案设计',
      [
        '先读与需求相关的代码，弄清现状与约束，然后在 summary 中写出方案设计：',
        '1. 现状：涉及的模块与文件、现有的做法与限制；',
        '2. 两到三个可行方案：每个写明做法、要改的模块、优点、代价与风险、大致工作量（只有一种合理做法时说明原因）；',
        '3. 推荐方案与理由；',
        '4. 按推荐方案实施的步骤，每步写明改什么、怎么验证。',
        '方案要基于代码现状，不编造不存在的模块与接口。这一步不改文件。',
      ].join('\n'),
    ),
  },
  {
    key: BuiltinWorkflowKey.DetailedDesign,
    name: '详细设计',
    description: '梳理现有代码后写一份能照着开发的详细设计文档，提交到仓库',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer],
      template: {
        nodes: [
          {
            key: 'survey',
            title: '梳理现状',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '读与需求相关的代码、文档与数据结构，在 summary 中整理：涉及的模块与文件、现有的接口与数据结构、关键调用链、约束与风险，以及仓库里设计文档放在哪个目录、用什么格式。这一步不改文件。',
            dependsOn: [],
            acceptance: unchecked,
          },
          {
            key: 'write',
            title: '编写详细设计',
            roleKey: BuiltinRoleKey.Developer,
            instructions: [
              '按需求与上一步的梳理写一份详细设计文档，放在仓库现有的设计文档目录并沿用其格式（没有时放在 docs/design/，Markdown，文件名用主题），内容包括：',
              '背景与目标；范围与不做的事；总体方案；模块划分与职责；接口定义（签名或请求与响应、错误）；数据结构与表结构的变更；关键流程；异常与边界情况；兼容与迁移；测试方案；实施步骤。',
              '写到开发者能直接照着实现的程度，与代码现状一致，不编造不存在的模块；用需求的语言书写。只写文档，不改代码。',
            ].join('\n'),
            dependsOn: ['survey'],
            acceptance: {
              checks: [
                aiReview('设计是否与代码现状一致、是否覆盖了需求的每一点、接口与数据结构是否具体到可以直接实施'),
              ],
              manual: false,
            },
          },
        ],
      },
      checkpoints: noCheckpoints,
      defaultAcceptance: unchecked,
    },
  },
];
