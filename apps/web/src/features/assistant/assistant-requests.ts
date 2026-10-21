import { AssistantForm } from '@aw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { useOpenAssistantPage } from './assistant-page.ts';

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * Carries out what the assistant asked the renderer to do (15 §3, §6): open a page or a prefilled form next to the
 * panel, or reveal a file in Finder. Each request runs once.
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
        void openPage(r.target);
        return;
      case 'reveal':
        // Finder is reached through the Electron preload; a plain browser (development) has none.
        if (window.aw !== undefined) void window.aw.revealInFinder(r.absolutePath);
        return;
      case 'form': {
        const { form, values } = r;
        switch (form) {
          case AssistantForm.StartTask:
            // The home form takes its prefill from the address, like the report card's「据此修复」.
            void (async () => {
              const workflows = await queryClient.fetchQuery(workflowsQuery);
              const workflow = workflows.find((w) => w.id === values.workflowId)?.key;
              const projectId = text(values.projectId);
              const requirement = text(values.requirement);
              await navigate({
                to: ROUTES.home,
                search: {
                  ...(projectId === undefined ? {} : { projectId }),
                  ...(workflow === undefined ? {} : { workflow }),
                  ...(requirement === undefined ? {} : { requirement }),
                },
              });
            })();
            return;
          case AssistantForm.AddProject:
            setPendingForm({ seq: request.seq, form, values });
            void navigate({ to: ROUTES.projects, search: { add: true } });
            return;
          case AssistantForm.ProjectHosting: {
            setPendingForm({ seq: request.seq, form, values });
            const projectId = text(values.id);
            if (projectId !== undefined) void navigate({ to: ROUTES.project, params: { projectId } });
            return;
          }
          case AssistantForm.AddDbConnection:
          case AssistantForm.EditDbConnection:
            setPendingForm({ seq: request.seq, form, values });
            void navigate({ to: ROUTES.databases });
            return;
        }
      }
    }
  }, [request, openPage, navigate, queryClient, setPendingForm]);
}
