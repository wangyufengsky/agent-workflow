import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  AssistantPage,
  type AssistantPageParam,
  type AssistantPageRef,
  ErrorCode,
  type GetCurrentTimeOutput,
  type TaskDetailDTO,
  UiMode,
} from '@aw/shared';
import type { BatchesService } from '../batches/index.ts';
import type { DecksService } from '../decks/index.ts';
import type { GitReviewsService } from '../git-reviews/index.ts';
import type { InitiativesService } from '../initiatives/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SchedulesService } from '../schedules/index.ts';
import type { TasksService } from '../tasks/index.ts';
import type { WorkflowsService } from '../workflows/index.ts';

/** `ms` as the wall-clock time of `timeZone` (15 §2): ISO with the zone's offset, the date and the weekday. */
export function localTime(ms: number, timeZone: string): GetCurrentTimeOutput {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  // `GMT+08:00`, or `GMT` alone for a zero offset.
  const zoneName = String(parts.timeZoneName);
  const utcOffset = zoneName === 'GMT' ? '+00:00' : zoneName.slice('GMT'.length);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    now: `${date}T${parts.hour}:${parts.minute}:${parts.second}${utcOffset}`,
    date,
    weekday: String(parts.weekday),
    timeZone,
    utcOffset,
  };
}

const STATIC_PAGES: Partial<Record<AssistantPage, string>> = {
  [AssistantPage.Home]: 'the home page (start a task)',
  [AssistantPage.Desktop]: 'the desktop companion chat; no project or task page is selected',
  [AssistantPage.Tasks]: 'the task list',
  [AssistantPage.Inbox]: 'the list of items that need the user',
  [AssistantPage.Projects]: 'the project list',
  [AssistantPage.Settings]: 'the settings page',
  [AssistantPage.Git]: 'the Git console',
  [AssistantPage.Workflows]: 'the workflow list',
  [AssistantPage.Roles]: 'the role list',
  [AssistantPage.Databases]: 'the database connections page',
  [AssistantPage.Tools]: 'the MCP tools page',
  [AssistantPage.Runtime]: 'the runtime page',
  [AssistantPage.Knowledge]: 'the knowledge Q&A page (ask a question about a project)',
  [AssistantPage.KnowledgeHistory]: 'the knowledge Q&A history',
  [AssistantPage.Insights]: 'the quality and usage page (how much AI did, how well, and what it cost)',
  [AssistantPage.Ppt]: 'the PPT list (slide decks made from a brief and material)',
  [AssistantPage.PptNew]: 'the new PPT page (a brief, material and the number of pages, then an outline)',
  [AssistantPage.Batches]: 'the batch list (one fixed workflow run over many targets)',
  [AssistantPage.BatchNew]: 'the new batch page (a project, a workflow and the targets to run it over)',
  [AssistantPage.Schedules]: 'the scheduled task list (a fixed workflow started at set times)',
  [AssistantPage.ScheduleNew]: 'the new scheduled task page (a project, a workflow, the requirement and when it runs)',
  [AssistantPage.Environment]: 'the environment checks (Git, opencode, models, credential storage)',
  [AssistantPage.Initiatives]:
    'the initiative list (a large requirement split into phases of work packages, each package a task)',
  [AssistantPage.InitiativeTemplates]:
    'the list of initiative composition templates (fixed phases and work packages an initiative can start from)',
  [AssistantPage.InitiativeTemplateNew]: 'the editor of a new initiative composition template',
};

/** 系统回传可能发生在页面对象删除之后；其他错误仍然显式失败。 */
const DELETED_PAGE_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.TaskNotFound,
  ErrorCode.NodeNotFound,
  ErrorCode.ProjectNotFound,
  ErrorCode.WorkflowNotFound,
  ErrorCode.KnowledgeConversationNotFound,
  ErrorCode.DeckNotFound,
  ErrorCode.DeckSlideNotFound,
  ErrorCode.BatchNotFound,
  ErrorCode.ScheduleNotFound,
  ErrorCode.InitiativeNotFound,
  ErrorCode.InitiativeTemplateNotFound,
  ErrorCode.GitReviewNotFound,
]);

function param(ref: AssistantPageRef, name: AssistantPageParam): string {
  const value = ref.params[name];
  // assistantPageRefSchema requires each page's params (ASSISTANT_PAGE_PARAMS).
  if (value === undefined) throw new Error(`Page ${ref.page} without ${name}`);
  return value;
}

export type ContextDeps = {
  prompts: Prompts;
  tasks: TasksService;
  projects: ProjectsService;
  workflows: WorkflowsService;
  knowledge: KnowledgeService;
  decks: DecksService;
  batches: BatchesService;
  schedules: SchedulesService;
  initiatives: InitiativesService;
  gitReviews: GitReviewsService;
};

/** What the model is told with every message (15 §2): time, interface mode, and the page the user is on. */
export function createContextRenderer(deps: ContextDeps) {
  const { prompts, tasks, projects, workflows, knowledge, decks, batches, schedules, initiatives, gitReviews } = deps;
  /** The ids of the page come from the renderer: a missing entity is a NOT_FOUND like any other input. */
  function describeTask(task: TaskDetailDTO, nodeId: string | undefined, prefix: string): string {
    const base = `${prefix} of task ${task.key} "${task.title}" (task id ${task.id}, status ${task.status}, project "${task.project.name}", project id ${task.project.id})`;
    if (nodeId === undefined) return base;
    const node = task.nodes.find((n) => n.id === nodeId);
    if (node === undefined) throw new AppError(ErrorCode.NodeNotFound, `Node ${nodeId} not found`, { nodeId });
    return `${base}, step "${node.title}" selected (node id ${node.id}, status ${node.status})`;
  }

  function describePage(ref: AssistantPageRef): string {
    const { page } = ref;
    const fixed = STATIC_PAGES[page];
    if (fixed !== undefined) return fixed;
    switch (page) {
      case AssistantPage.Task:
      case AssistantPage.Node: {
        const task = tasks.detail(param(ref, 'taskId'));
        return describeTask(task, ref.params.nodeId, page === AssistantPage.Task ? 'the page' : 'the step page');
      }
      case AssistantPage.TaskPreview:
        // What the user looks at there is the page `browser_read` reads (29 §9).
        return describeTask(tasks.detail(param(ref, 'taskId')), undefined, 'the preview tab');
      case AssistantPage.Project:
      case AssistantPage.GitProject:
      case AssistantPage.Team: {
        const project = projects.getRecord(param(ref, 'projectId'));
        const where = {
          [AssistantPage.Project]: 'the page',
          [AssistantPage.GitProject]: 'the Git console',
          [AssistantPage.Team]: "the team page (each member's commits, no scores)",
        }[page];
        return `${where} of project "${project.name}" (project id ${project.id}, repository ${project.repoPath})`;
      }
      case AssistantPage.TeamMember: {
        const project = projects.getRecord(param(ref, 'projectId'));
        return `the team page of member ${param(ref, 'teamMember')} in project "${project.name}" (project id ${project.id}; their commits, trends and AI analyses, no scores)`;
      }
      case AssistantPage.Workflow: {
        const key = param(ref, 'workflowKey');
        const workflow = workflows.list().find((w) => w.key === key);
        if (workflow === undefined)
          throw new AppError(ErrorCode.WorkflowNotFound, `Workflow ${key} not found`, { key });
        return `the editor of workflow "${workflow.name}" (key ${workflow.key}, id ${workflow.id})`;
      }
      case AssistantPage.KnowledgeConversation: {
        const conversation = knowledge.get(param(ref, 'knowledgeConversationId'));
        return `the knowledge Q&A conversation "${conversation.title}" (knowledge conversation id ${conversation.id}, project "${conversation.project.name}", ${conversation.turns.length} questions)`;
      }
      case AssistantPage.PptDeck: {
        const deck = decks.get(param(ref, 'deckId'));
        const base = `the workspace of PPT "${deck.title}" (deck id ${deck.id}, status ${deck.status}, ${deck.slides.length} pages)`;
        const { slideId } = ref.params;
        if (slideId === undefined) return base;
        const slide = deck.slides.find((s) => s.id === slideId);
        if (slide === undefined)
          throw new AppError(ErrorCode.DeckSlideNotFound, `Page ${slideId} not found`, { slideId });
        return `${base}, page ${slide.seq} "${slide.title}" selected (slide id ${slide.id})`;
      }
      case AssistantPage.Batch: {
        const batch = batches.detail(param(ref, 'batchId'));
        return `the page of batch ${batch.key} "${batch.title}" (batch id ${batch.id}, project "${batch.project.name}", workflow "${batch.workflow.name}", ${batch.ended} of ${batch.total} tasks ended)`;
      }
      case AssistantPage.Schedule:
      case AssistantPage.ScheduleEdit: {
        const schedule = schedules.detail(param(ref, 'scheduleId'));
        const where = page === AssistantPage.Schedule ? 'the page' : 'the edit page';
        return `${where} of scheduled task "${schedule.title}" (schedule id ${schedule.id}, status ${schedule.status}, project "${schedule.project.name}", workflow key ${schedule.workflow.key})`;
      }
      case AssistantPage.Initiative: {
        const initiative = initiatives.detail(param(ref, 'initiativeId'));
        return `the page of initiative ${initiative.key} "${initiative.title}" (initiative id ${initiative.id}, status ${initiative.status}, project "${initiative.project.name}", ${initiative.openedPhase} of ${initiative.phaseCount} phases opened, ${initiative.doneCount} of ${initiative.itemCount} work packages done)`;
      }
      case AssistantPage.InitiativeTemplate: {
        const template = initiatives.templates.get(param(ref, 'templateKey'));
        return `the editor of initiative composition template "${template.name}" (key ${template.key}, ${template.kind}, ${template.phases.length} phases, ${template.items.length} work packages)`;
      }
      case AssistantPage.GitReview: {
        const review = gitReviews.get(param(ref, 'gitReviewId'));
        const project = projects.getRecord(review.projectId);
        return `the AI review of ${review.label} in the Git console of project "${project.name}" (review id ${review.id}, status ${review.status}, ${review.findings.length} findings)`;
      }
      default:
        throw new Error(`Page ${page} has no description`);
    }
  }

  function describeContextPage(ref: AssistantPageRef | undefined, source: 'user' | 'app'): string {
    if (ref === undefined) return 'unknown (the message was sent by the app)';
    try {
      return describePage(ref);
    } catch (err) {
      if (source === 'app' && err instanceof AppError && DELETED_PAGE_ERRORS.has(err.code)) {
        return `The page from the user's last message (${ref.page}, ${JSON.stringify(ref.params)}) no longer exists (${err.code}). Do not treat it as their current page.`;
      }
      throw err;
    }
  }

  return {
    render(input: {
      time: GetCurrentTimeOutput;
      uiMode: UiMode;
      page: AssistantPageRef | undefined;
      filesDir: string;
      source: 'user' | 'app';
    }) {
      const { time } = input;
      return renderTemplate(prompts[PromptName.AssistantContext], {
        now: time.now,
        weekday: time.weekday,
        timeZone: time.timeZone,
        utcOffset: time.utcOffset,
        uiMode: input.uiMode,
        modeNote:
          input.uiMode === UiMode.Simple
            ? 'Pro-mode functions are not available; the user can switch to pro mode in the settings.'
            : 'All functions are available.',
        page: describeContextPage(input.page, input.source),
        filesDir: input.filesDir,
      });
    },
  };
}
export type ContextRenderer = ReturnType<typeof createContextRenderer>;
