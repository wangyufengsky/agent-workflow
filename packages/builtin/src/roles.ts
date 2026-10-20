import { RoleBaseAgent } from '@aw/shared';

/** Built-in role (13 §2); its prompt is `prompts/roles/<key>.md`. */
export type BuiltinRole = { key: string; name: string; baseAgent: RoleBaseAgent; description: string };

export const BuiltinRoleKey = {
  Planner: 'planner',
  Developer: 'developer',
  Tester: 'tester',
  Reviewer: 'reviewer',
} as const;
export type BuiltinRoleKey = (typeof BuiltinRoleKey)[keyof typeof BuiltinRoleKey];

export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  {
    key: BuiltinRoleKey.Planner,
    name: '规划师',
    baseAgent: RoleBaseAgent.Planner,
    description: '先读代码再规划，把需求拆成可以独立完成并验证的步骤',
  },
  {
    key: BuiltinRoleKey.Developer,
    name: '开发工程师',
    baseAgent: RoleBaseAgent.Executor,
    description: '按仓库现有风格做最小必要的改动，找根因不兜底，改完自己跑测试',
  },
  {
    key: BuiltinRoleKey.Tester,
    name: '测试工程师',
    baseAgent: RoleBaseAgent.Executor,
    description: '编写验证行为的测试，不写冗余与脆弱的测试，运行检查并报告发现的缺陷',
  },
  {
    key: BuiltinRoleKey.Reviewer,
    name: '评审员',
    baseAgent: RoleBaseAgent.Reviewer,
    description: '对照需求与步骤指令评审改动，只报真实问题并给出位置与严重程度',
  },
];
