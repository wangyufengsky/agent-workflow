import {
  type Acceptance,
  AcceptanceCheckKind,
  PROJECT_CHECK_PLACEHOLDER,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import { BuiltinRoleKey } from './roles.ts';
import type { BuiltinWorkflow } from './workflows.ts';

/**
 * Workflows the app starts itself (`WorkflowKind.System`); never listed or chosen by the user. Their keys have a dot,
 * which `DEFINITION_KEY_PATTERN` does not allow, so a user's workflow can never have the same key: seeding one would
 * otherwise make it the latest version of the user's workflow and hide that.
 */
export const SystemWorkflowKey = {
  /** The Git workbench's 「交给 AI 解决」 after a conflicting merge (27 §3.6). */
  MergeBranch: 'system.merge_branch',
  /** The project page's「让 AI 生成 / 补充」AGENTS.md (40 §4, D202). */
  AgentsMd: 'system.agents_md',
} as const;
export type SystemWorkflowKey = (typeof SystemWorkflowKey)[keyof typeof SystemWorkflowKey];

const checked: Acceptance = {
  checks: [{ kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER }],
  manual: false,
};
const unchecked: Acceptance = { checks: [], manual: false };

export const SYSTEM_WORKFLOWS: readonly BuiltinWorkflow[] = [
  {
    key: SystemWorkflowKey.MergeBranch,
    name: '合并分支',
    description: '把一个分支合并到另一个分支，由 AI 在独立的工作区中解决冲突',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer],
      template: {
        nodes: [
          {
            key: 'resolve_conflicts',
            title: '解决合并冲突',
            roleKey: BuiltinRoleKey.Developer,
            instructions:
              '后端已在本工作区执行 git merge，把任务需求中的目标分支合并进来并保留了冲突标记。先运行 `git diff --name-only --diff-filter=U` 列出有冲突的文件，逐个解决：保留两边的改动、去掉所有冲突标记，然后运行检查。不要执行改动 Git 的命令（add、commit、merge 等）：本步骤完成时后端提交，即完成这次合并。',
            dependsOn: [],
            acceptance: checked,
          },
        ],
      },
      checkpoints: { confirm_plan: false, accept_each_node: false },
      defaultAcceptance: checked,
    },
  },
  {
    key: SystemWorkflowKey.AgentsMd,
    name: '整理 AGENTS.md',
    description: '梳理项目的命令、结构与约定，生成或补充根目录的 AGENTS.md',
    planning: WorkflowPlanning.Fixed,
    deliverable: WorkflowDeliverable.CodeChanges,
    definition: {
      allowedRoles: [BuiltinRoleKey.Developer],
      template: {
        nodes: [
          {
            key: 'survey',
            title: '梳理项目约定',
            roleKey: BuiltinRoleKey.Developer,
            instructions: [
              '读根目录的 AGENTS.md（有时）、README、CONTRIBUTING、CLAUDE.md、.cursorrules，构建与包管理文件（package.json、Makefile、pom.xml、build.gradle、go.mod、pyproject.toml 等）、lint / 格式化 / 类型检查配置、CI 配置与测试目录。',
              '在 notes 中整理：项目是什么（一两句）；主要目录与职责；仓库里真实存在的安装、构建、测试、lint 命令（每条注明出自哪个文件）；从配置与代码看出的编码约定；测试约定；提交与分支约定（有时）。summary 只写简要结论。这一步不改文件。',
            ].join('\n'),
            dependsOn: [],
            acceptance: unchecked,
          },
          {
            key: 'write',
            title: '编写 AGENTS.md',
            roleKey: BuiltinRoleKey.Developer,
            instructions: [
              '先用 get_node_output 读 survey 的完整产出。根目录没有 AGENTS.md 时新建；已有时补充：保留原有内容与结构，只增加缺的部分、在原有小节里补充，不删除已有内容，发现与代码不符的地方写进 summary，不擅自改。',
              '内容简洁（建议 200 行以内），只写对 AI 编码有用的事实与约定：项目概述、目录结构、常用命令、编码约定、测试约定、注意事项。命令必须是仓库里真实存在的，不编造。语言跟随已有的 AGENTS.md，没有时跟随需求。',
              '需求里给出了「在 Agent Workflow 中工作」一节时照原文加入（已有同名一节时替换它），只按文档的语言调整措辞，不改变规则的意思。只改 AGENTS.md，不改其他文件。',
            ].join('\n'),
            dependsOn: ['survey'],
            acceptance: {
              checks: [
                {
                  kind: AcceptanceCheckKind.AiReview,
                  focus:
                    '命令与路径是否与仓库一致；补充时是否保留了原有内容；是否只改了 AGENTS.md；需求给出的规则是否按原意加入',
                },
              ],
              manual: false,
            },
          },
        ],
      },
      checkpoints: { confirm_plan: false, accept_each_node: false },
      defaultAcceptance: unchecked,
    },
  },
];

/** The merge task's title and requirement (27 §3.6): merging `source` into `target`. */
export function mergeTaskText(source: string, target: string): { title: string; requirement: string } {
  return {
    title: `合并 ${source} → ${target}`,
    requirement: `把 \`${source}\` 合并到 \`${target}\`，解决合并冲突。`,
  };
}

/**
 * The AGENTS.md task's title and requirement (40 §4): generate when the default branch has none, else supplement;
 * the user's notes and the rendered「在 Agent Workflow 中工作」section when given.
 */
export function agentsMdTaskText(input: {
  exists: boolean;
  checkCommand: string | null;
  notes: string | undefined;
  rules: string | undefined;
}): { title: string; requirement: string } {
  const parts = [
    input.exists ? '补充项目的 AGENTS.md，保留已有内容。' : '为项目生成 AGENTS.md。',
    input.checkCommand === null ? '项目没有设置检查命令。' : `项目的检查命令：\`${input.checkCommand}\`。`,
  ];
  if (input.notes !== undefined) parts.push(`补充说明：\n\n${input.notes}`);
  if (input.rules !== undefined)
    parts.push(`在 AGENTS.md 中加入下面这一节（已有同名一节时替换它）：\n\n${input.rules}`);
  return { title: input.exists ? '补充 AGENTS.md' : '生成 AGENTS.md', requirement: parts.join('\n\n') };
}

/** What the rules template's `{{check}}` says: the project's check command, or its tests when it has none (40 §5). */
export const agentsMdRulesCheck = (checkCommand: string | null) =>
  checkCommand === null ? '项目的测试' : `项目的检查命令 \`${checkCommand}\``;
