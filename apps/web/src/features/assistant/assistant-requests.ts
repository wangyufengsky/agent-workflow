import { AssistantForm, AssistantPage } from '@aw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { useOpenAssistantPage } from './assistant-page.ts';
import { followAssistant } from './handoff.ts';

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * Carries out what the assistant asked the renderer to do (15 §3, §6): open a page or a prefilled form next to the
 * panel, or reveal a file in Finder. Each request runs once. Pages other than home show the conversation in the panel
 * (D112); the home page shows it itself.
 */
export function useAssistantRequests(): void {
  const request = useUiStore((s) => s.assistantRequest);
  const setPendingForm = useUiStore((s) => s.setPendingForm);
  const openPage = useOpenAssistantPage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const handled = useRef(0);

  useEffect(() => {
    if (request === null || request.seq === handled.current) return;
    handled.current = request.seq;
    const r = request.request;
    switch (r.kind) {
      case 'navigate':
        if (r.target.page === AssistantPage.Home) void openPage(r.target);
        else followAssistant(() => openPage(r.target));
        return;
      case 'reveal':
        // Finder is reached through the Electron preload; a plain browser (development) has none.
        if (window.aw !== undefined) void window.aw.revealInFinder(r.absolutePath);
        return;
      case 'form': {
        const { form, values } = r;
        switch (form) {
          case AssistantForm.StartTask:
            void (async () => {
              const workflows = await queryClient.fetchQuery(workflowsQuery);
              const workflow = workflows.find((w) => w.id === values.workflowId)?.key;
              const projectId = text(values.projectId);
              const requirement = text(values.requirement);
              // Home puts its input in「开始任务」mode with the prefill (D111), under the conversation if one is shown.
              await navigate({
                to: ROUTES.home,
                search: (s) => ({
                  ...(s.conversation === undefined ? {} : { conversation: s.conversation }),
                  ...(projectId === undefined ? {} : { projectId }),
                  ...(workflow === undefined ? {} : { workflow }),
                  ...(requirement === undefined ? {} : { requirement }),
                }),
              });
            })();
            return;
          case AssistantForm.AddProject:
            setPendingForm({ seq: request.seq, form, values });
            followAssistant(() => navigate({ to: ROUTES.projects, search: { add: true } }));
            return;
          case AssistantForm.ProjectHosting: {
            setPendingForm({ seq: request.seq, form, values });
            const projectId = text(values.id);
            if (projectId !== undefined) followAssistant(() => navigate({ to: ROUTES.project, params: { projectId } }));
            return;
          }
          case AssistantForm.AddDbConnection:
          case AssistantForm.EditDbConnection:
            setPendingForm({ seq: request.seq, form, values });
            followAssistant(() => navigate({ to: ROUTES.databases }));
            return;
        }
      }
    }
  }, [request, openPage, navigate, queryClient, setPendingForm]);
}
