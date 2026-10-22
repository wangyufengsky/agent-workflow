import {
  type Acceptance,
  AcceptanceCheckKind,
  PROJECT_CHECK_PLACEHOLDER,
  WorkflowDeliverable,
  WorkflowPlanning,
} from '@aw/shared';
import { BuiltinRoleKey } from './roles.ts';
import type { BuiltinWorkflow } from './workflows.ts';

/** Workflows the app starts itself (`WorkflowKind.System`); never listed or chosen by the user. */
export const SystemWorkflowKey = {
  /** The Git workbench's 「交给 AI 解决」 after a conflicting merge (27 §3.6). */
  MergeBranch: 'merge_branch',
} as const;
export type SystemWorkflowKey = (typeof SystemWorkflowKey)[keyof typeof SystemWorkflowKey];

const checked: Acceptance = {
  checks: [{ kind: AcceptanceCheckKind.Command, command: PROJECT_CHECK_PLACEHOLDER }],
  manual: false,
};

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
];

/** The merge task's title and requirement (27 §3.6): merging `source` into `target`. */
export function mergeTaskText(source: string, target: string): { title: string; requirement: string } {
  return {
    title: `合并 ${source} → ${target}`,
    requirement: `把 \`${source}\` 合并到 \`${target}\`，解决合并冲突。`,
  };
}
