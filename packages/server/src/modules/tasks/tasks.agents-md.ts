import { agentsMdRulesCheck, agentsMdTaskText, PromptName, renderTemplate, SystemWorkflowKey } from '@aw/builtin';
import {
  AGENTS_MD_PATH,
  type AgentsMdDTO,
  AppError,
  ErrorCode,
  type GitFileDTO,
  GitTreeEntryType,
  isTerminalState,
  type StartAgentsMdTaskRequest,
  taskMachine,
} from '@aw/shared';
import { branchExists, readFile, readTree } from '../git/index.ts';
import type { TaskLifecycle } from './tasks.lifecycle.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

/**
 * The project page's AGENTS.md (40): the committed one on the default branch (D203), and tasks of the system workflow
 * `agents_md` that generate or supplement it in their own worktree (D202).
 */
export function createTaskAgentsMd(deps: TasksServiceDeps, state: TaskState, lifecycle: TaskLifecycle) {
  const { projects, workflows, prompts } = deps;

  async function defaultBranchOf(projectId: string) {
    const project = projects.getRecord(projectId);
    if (!(await branchExists(project.repoPath, project.defaultBranch))) {
      throw new AppError(ErrorCode.GitBaseBranchNotFound, 'Default branch does not exist', {
        branch: project.defaultBranch,
      });
    }
    return project;
  }

  async function readAgentsMd(repoPath: string, branch: string): Promise<GitFileDTO | null> {
    const root = await readTree(repoPath, branch, '');
    const isFile = root.some((e) => e.name === AGENTS_MD_PATH && e.type === GitTreeEntryType.Blob);
    return isFile ? readFile(repoPath, branch, AGENTS_MD_PATH) : null;
  }

  const rulesFor = (checkCommand: string | null) =>
    renderTemplate(prompts[PromptName.AgentsMdRules], { check: agentsMdRulesCheck(checkCommand) }).trim();

  /** The project's latest AGENTS.md task that has not ended; the joined key matches every version of the workflow. */
  function openTask(projectId: string) {
    const task = state.repo
      .list({ projectId })
      .find((t) => !isTerminalState(taskMachine, t.status) && t.workflowKey === SystemWorkflowKey.AgentsMd);
    return task === undefined ? null : state.summary(task);
  }

  return {
    async get(projectId: string): Promise<AgentsMdDTO> {
      const project = await defaultBranchOf(projectId);
      return {
        branch: project.defaultBranch,
        file: await readAgentsMd(project.repoPath, project.defaultBranch),
        rules: rulesFor(project.checkCommand),
        task: openTask(projectId),
      };
    },

    /** Generates when the default branch has no AGENTS.md, else supplements it (40 §4). */
    async createTask({ id: projectId, guidance, includeRules }: StartAgentsMdTaskRequest): Promise<string> {
      const project = await defaultBranchOf(projectId);
      const file = await readAgentsMd(project.repoPath, project.defaultBranch);
      const workflow = workflows.system(SystemWorkflowKey.AgentsMd);
      const id = lifecycle.insertDraft({
        projectId,
        workflowId: workflow.id,
        ...agentsMdTaskText({
          exists: file !== null,
          checkCommand: project.checkCommand,
          notes: guidance,
          rules: includeRules ? rulesFor(project.checkCommand) : undefined,
        }),
        baseBranch: project.defaultBranch,
      });
      lifecycle.start(id);
      return id;
    },
  };
}
