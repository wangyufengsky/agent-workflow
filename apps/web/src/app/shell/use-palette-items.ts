import {
  API_PREFIX,
  listOperationsResponseSchema,
  OperationExposure,
  type ThemePreference,
  themePreferenceSchema,
  UiMode,
} from '@aw/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { getJson } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import type { PaletteItem } from '../../components/command-palette.tsx';
import { OPERATION_TITLE } from '../../copy/operations.ts';
import { PALETTE_COPY } from '../../copy/palette.ts';
import { TASK_DISPLAY_LABEL } from '../../copy/tasks.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { useRecheckEnvironment } from '../../features/onboarding/environment.queries.ts';
import { projectsQuery } from '../../features/projects/projects.queries.ts';
import { useRestartRuntime } from '../../features/runtime/runtime.queries.ts';
import { useSettings, useUpdateSettings } from '../../features/settings/settings.queries.ts';
import { tasksQuery } from '../../features/tasks/tasks.queries.ts';
import { navItemsFor } from '../navigation.ts';
import { ROUTES } from '../routes.ts';

const paletteOperationsQuery = queryOptions({
  queryKey: queryKeys.paletteOperations,
  queryFn: () => getJson(`${API_PREFIX}/operations?expose=${OperationExposure.Palette}`, listOperationsResponseSchema),
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Palette sources (14 §2.1): pages for the current mode, recent tasks and projects to open, client commands, and the
 * palette-exposed operations of the current mode (the backend leaves out critical ones). Operations with parameters
 * open the page or form that asks for them.
 */
export function usePaletteItems(): PaletteItem[] {
  const navigate = useNavigate();
  const settings = useSettings();
  const update = useUpdateSettings();
  const recheck = useRecheckEnvironment();
  const restart = useRestartRuntime();
  const operations = useQuery(paletteOperationsQuery).data?.items ?? [];
  const tasks = useQuery(tasksQuery()).data ?? [];
  const projects = useQuery(projectsQuery).data ?? [];
  const mode = settings['ui.mode'];

  const pages: PaletteItem[] = navItemsFor(mode).map((item) => ({
    id: `page.${item.id}`,
    group: PALETTE_COPY.groupPages,
    label: item.label,
    run: () => void navigate({ to: item.route }),
  }));
  const themes: PaletteItem[] = themePreferenceSchema.options
    .filter((t) => t !== settings['ui.theme'])
    .map((t: ThemePreference) => ({
      id: `theme.${t}`,
      group: PALETTE_COPY.groupActions,
      label: `${PALETTE_COPY.switchTheme}${THEME_LABEL[t]}`,
      keywords: 'theme 主题',
      run: () => update.mutate({ 'ui.theme': t }),
    }));
  const modeToggle: PaletteItem = {
    id: 'mode.toggle',
    group: PALETTE_COPY.groupActions,
    label: mode === UiMode.Simple ? PALETTE_COPY.enablePro : PALETTE_COPY.disablePro,
    keywords: 'mode 模式 pro',
    run: () => update.mutate({ 'ui.mode': mode === UiMode.Simple ? UiMode.Pro : UiMode.Simple }),
  };
  const taskItems: PaletteItem[] = tasks.map((t) => ({
    id: `task.${t.id}`,
    group: PALETTE_COPY.groupTasks,
    label: `${t.key} · ${t.title}`,
    hint: TASK_DISPLAY_LABEL[t.displayGroup],
    keywords: `${t.project.name} ${t.workflow.name}`,
    run: () => void navigate({ to: ROUTES.task, params: { taskId: t.id } }),
  }));
  const projectItems: PaletteItem[] = projects.map((p) => ({
    id: `project.${p.id}`,
    group: PALETTE_COPY.groupProjects,
    label: p.name,
    keywords: p.repoPath,
    run: () => void navigate({ to: ROUTES.project, params: { projectId: p.id } }),
  }));
  // Operations the renderer knows how to start; those with parameters open their form.
  const operationRunners: Record<string, () => void> = {
    'system.recheckEnvironment': () => recheck.mutate(),
    'system.restartRuntime': () => restart.mutate(),
    'projects.create': () => void navigate({ to: ROUTES.projects, search: { add: true } }),
    'tasks.create': () => void navigate({ to: ROUTES.home }),
    'batches.create': () => void navigate({ to: ROUTES.batchNew }),
    'schedules.create': () => void navigate({ to: ROUTES.scheduleNew }),
  };
  const actions: PaletteItem[] = operations
    .filter((op) => mode === UiMode.Pro || op.mode === UiMode.Simple)
    .flatMap((op) => {
      const run = operationRunners[op.id];
      const label = OPERATION_TITLE[op.title];
      return run === undefined || label === undefined
        ? []
        : [{ id: `op.${op.id}`, group: PALETTE_COPY.groupActions, label, run }];
    });
  return [...pages, ...actions, modeToggle, ...themes, ...taskItems, ...projectItems];
}
