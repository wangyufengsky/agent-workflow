import { UiMode } from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { REQUIREMENTS_COPY } from '../../copy/requirements.ts';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { type DraftRequirement, isComplete, toInputs } from '../requirements/checklist-editor.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { useCreateTask } from '../tasks/tasks.queries.ts';
import { type MoreOptions, NO_OPTIONS } from './more-options.tsx';

/**
 * 「开始任务」in one step (14 §3.2, D111): the same `tasks.create` the old form called, straight from the home input
 * without the assistant. `workflowId` and `requirement` are the input's; the rest is this mode's own state.
 */
export function useStartTask({
  projectId,
  workflowId,
  requirement,
  attachmentIds,
  attachmentsBlocked,
  requirements,
  onStarted,
}: {
  projectId: string;
  workflowId: string | undefined;
  requirement: string;
  /** Files attached to the requirement (30 §2); none are still uploading or failed. */
  attachmentIds: readonly string[];
  /** An attachment is uploading or failed: the task waits until it is removed (30 §2). */
  attachmentsBlocked: boolean;
  /** The acceptance checklist being written (31 §2.1); empty for none. */
  requirements: readonly DraftRequirement[];
  onStarted: () => void;
}) {
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [options, setOptions] = useState<MoreOptions>(NO_OPTIONS);
  const create = useCreateTask();
  const navigate = useNavigate();
  const checklistReady = isComplete(requirements);
  const canStart =
    workflowId !== undefined && projectId !== '' && requirement.trim() !== '' && !attachmentsBlocked && checklistReady;
  // Why「开始」is unavailable, said next to it (only the requirement can be missing once projects and workflows load).
  const blocked = canStart
    ? undefined
    : requirement.trim() === ''
      ? C.needsRequirement
      : attachmentsBlocked
        ? ATTACHMENTS_COPY.notReady
        : !checklistReady
          ? REQUIREMENTS_COPY.incomplete
          : C.needsWorkflow;

  const start = (asDraft = false) => {
    if (!canStart) return;
    const more = pro ? options : NO_OPTIONS;
    const checkpoints = {
      ...(confirmPlan ? { confirm_plan: true } : {}),
      ...(more.acceptEachNode === null ? {} : { accept_each_node: more.acceptEachNode }),
      ...(more.askOnUncertainty === null ? {} : { ask_on_uncertainty: more.askOnUncertainty }),
    };
    create.mutate(
      {
        projectId,
        workflowId,
        requirement: requirement.trim(),
        ...(Object.keys(checkpoints).length === 0 ? {} : { checkpoints }),
        ...(more.title.trim() === '' ? {} : { title: more.title.trim() }),
        ...(more.baseBranch === null ? {} : { baseBranch: more.baseBranch }),
        ...(asDraft ? { start: false } : {}),
        ...(attachmentIds.length === 0 ? {} : { attachmentIds: [...attachmentIds] }),
        ...(requirements.length === 0 ? {} : { requirements: toInputs(requirements) }),
      },
      {
        onSuccess: (task) => {
          onStarted();
          void navigate({ to: ROUTES.task, params: { taskId: task.id } });
        },
      },
    );
  };
  return { pro, confirmPlan, setConfirmPlan, options, setOptions, canStart, blocked, start, create };
}
