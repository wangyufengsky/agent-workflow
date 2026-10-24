import { AssistantPage, type AssistantPageParam, type AssistantPageRef } from '@aw/shared';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ROUTES } from '../../app/routes.ts';

/** The route of each page the assistant knows (14 §1). */
const PAGE_ROUTE = {
  [AssistantPage.Home]: ROUTES.home,
  [AssistantPage.Desktop]: '/companion',
  [AssistantPage.Tasks]: ROUTES.tasks,
  [AssistantPage.Task]: ROUTES.task,
  /** The task page with its preview tab shown (`?view=preview`, 29 §8.1). */
  [AssistantPage.TaskPreview]: ROUTES.task,
  [AssistantPage.Node]: ROUTES.node,
  [AssistantPage.Inbox]: ROUTES.inbox,
  [AssistantPage.Projects]: ROUTES.projects,
  [AssistantPage.Project]: ROUTES.project,
  [AssistantPage.Settings]: ROUTES.settings,
  [AssistantPage.Git]: ROUTES.git,
  [AssistantPage.GitProject]: ROUTES.gitProject,
  [AssistantPage.Workflows]: ROUTES.workflows,
  [AssistantPage.Workflow]: ROUTES.workflow,
  [AssistantPage.Roles]: ROUTES.roles,
  [AssistantPage.Databases]: ROUTES.databases,
  [AssistantPage.Tools]: ROUTES.tools,
  [AssistantPage.Runtime]: ROUTES.runtime,
  [AssistantPage.Knowledge]: ROUTES.knowledge,
  [AssistantPage.KnowledgeConversation]: ROUTES.knowledgeConversation,
  [AssistantPage.KnowledgeHistory]: ROUTES.knowledgeHistory,
  [AssistantPage.Insights]: ROUTES.insights,
  [AssistantPage.Ppt]: ROUTES.ppt,
  [AssistantPage.PptDeck]: ROUTES.pptDeck,
  [AssistantPage.Batches]: ROUTES.batches,
  [AssistantPage.Batch]: ROUTES.batch,
  [AssistantPage.Schedules]: ROUTES.schedules,
  [AssistantPage.Schedule]: ROUTES.schedule,
  [AssistantPage.Environment]: ROUTES.environment,
} as const satisfies Record<AssistantPage, string>;

/** The preview tab shares the task page's route; its `view` tells them apart. */
const PAGE_OF_ROUTE = new Map<string, AssistantPage>(
  Object.values(AssistantPage)
    .filter((page) => page !== AssistantPage.TaskPreview)
    .map((page) => [PAGE_ROUTE[page], page]),
);

/** The backend checked that the page has its params (`ASSISTANT_PAGE_PARAMS`). */
function param(ref: AssistantPageRef, name: AssistantPageParam): string {
  const value = ref.params[name];
  if (value === undefined) throw new Error(`Page ${ref.page} without ${name}`);
  return value;
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Where the user is, sent with each message (15 §2): the page and the ids it is about, the selected step included. */
export function useAssistantPage(): AssistantPageRef {
  return useRouterState({
    select: (state): AssistantPageRef => {
      const match = state.matches.at(-1);
      const page = match === undefined ? undefined : PAGE_OF_ROUTE.get(match.fullPath);
      if (match === undefined || page === undefined) return { page: AssistantPage.Home, params: {} };
      const params: Record<string, unknown> = match.params;
      const search: Record<string, unknown> = match.search;
      if (page === AssistantPage.Task && search.view === 'preview') {
        return { page: AssistantPage.TaskPreview, params: { taskId: String(params.taskId) } };
      }
      const ids = {
        taskId: text(params.taskId),
        nodeId: text(params.nodeId) ?? text(search.node),
        projectId: text(params.projectId),
        workflowKey: text(params.key),
        knowledgeConversationId: text(params.conversationId),
        deckId: text(params.deckId),
        slideId: text(search.slide),
        batchId: text(params.batchId),
        scheduleId: text(params.scheduleId),
      };
      return {
        page,
        params: Object.fromEntries(Object.entries(ids).filter(([, v]) => v !== undefined)),
      };
    },
    structuralSharing: true,
  });
}

/** Opens a page for the assistant's `open_page` (15 §6): next to the panel, which stays open. */
export function useOpenAssistantPage() {
  const navigate = useNavigate();
  return useCallback(
    (ref: AssistantPageRef) => {
      switch (ref.page) {
        case AssistantPage.Task:
          return navigate({
            to: ROUTES.task,
            params: { taskId: param(ref, 'taskId') },
            search: ref.params.nodeId === undefined ? {} : { node: ref.params.nodeId },
          });
        case AssistantPage.TaskPreview:
          return navigate({ to: ROUTES.task, params: { taskId: param(ref, 'taskId') }, search: { view: 'preview' } });
        case AssistantPage.Node:
          return navigate({
            to: ROUTES.node,
            params: { taskId: param(ref, 'taskId'), nodeId: param(ref, 'nodeId') },
          });
        case AssistantPage.Project:
          return navigate({ to: ROUTES.project, params: { projectId: param(ref, 'projectId') } });
        case AssistantPage.GitProject:
          return navigate({ to: ROUTES.gitProject, params: { projectId: param(ref, 'projectId') } });
        case AssistantPage.Workflow:
          return navigate({ to: ROUTES.workflow, params: { key: param(ref, 'workflowKey') } });
        case AssistantPage.KnowledgeConversation:
          return navigate({
            to: ROUTES.knowledgeConversation,
            params: { conversationId: param(ref, 'knowledgeConversationId') },
          });
        case AssistantPage.PptDeck:
          return navigate({
            to: ROUTES.pptDeck,
            params: { deckId: param(ref, 'deckId') },
            search: ref.params.slideId === undefined ? {} : { slide: ref.params.slideId },
          });
        case AssistantPage.Batch:
          return navigate({ to: ROUTES.batch, params: { batchId: param(ref, 'batchId') } });
        case AssistantPage.Schedule:
          return navigate({ to: ROUTES.schedule, params: { scheduleId: param(ref, 'scheduleId') } });
        default:
          return navigate({ to: PAGE_ROUTE[ref.page] });
      }
    },
    [navigate],
  );
}
