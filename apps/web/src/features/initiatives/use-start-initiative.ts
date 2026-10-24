import type { InitiativeTemplateDTO, WorkflowSummaryDTO } from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { INITIATIVES_COPY as C } from '../../copy/initiatives.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import { useCreateInitiative } from './initiatives.queries.ts';

/** A template's phases as a chain of its workflows' names; work in the same phase runs side by side (34 §15.4). */
export function templateChain(template: InitiativeTemplateDTO, workflows: readonly WorkflowSummaryDTO[]): string {
  const name = (key: string) => workflows.find((w) => w.key === key)?.name ?? key;
  return C.chain(
    template.phases.map((_, i) =>
      template.items
        .filter((item) => item.phase === i + 1)
        .map((item) => name(item.workflow))
        .join(' ∥ '),
    ),
  );
}

/**
 * 「开始 · 组合模板」from the home input (34 §15.4): one call creates the initiative and starts its first phase. With
 * `breakdown` instead of a template, the AI breaks the requirement down into a draft first (34 §5.1).
 */
export function useStartInitiative({
  projectId,
  templateKey,
  breakdown,
  requirement,
  attachmentIds,
  attachmentsBlocked,
  onStarted,
}: {
  projectId: string;
  templateKey: string | undefined;
  breakdown: boolean;
  requirement: string;
  attachmentIds: readonly string[];
  attachmentsBlocked: boolean;
  onStarted: () => void;
}) {
  const [confirmItemPlans, setConfirmItemPlans] = useState(false);
  const [review, setReview] = useState(false);
  const create = useCreateInitiative();
  const navigate = useNavigate();
  const canStart =
    (templateKey !== undefined || breakdown) && projectId !== '' && requirement.trim() !== '' && !attachmentsBlocked;
  const blocked = canStart
    ? undefined
    : requirement.trim() === ''
      ? HOME_TASK_COPY.needsRequirement
      : attachmentsBlocked
        ? ATTACHMENTS_COPY.notReady
        : undefined;
  const start = () => {
    if (!canStart) return;
    create.mutate(
      {
        projectId,
        ...(templateKey === undefined ? {} : { templateKey }),
        requirement: requirement.trim(),
        review,
        confirmItemPlans,
        ...(attachmentIds.length === 0 ? {} : { attachmentIds: [...attachmentIds] }),
      },
      {
        onSuccess: (initiative) => {
          onStarted();
          void navigate({ to: ROUTES.initiative, params: { initiativeId: initiative.id } });
        },
      },
    );
  };
  return { confirmItemPlans, setConfirmItemPlans, review, setReview, canStart, blocked, start, create };
}
