import {
  KNOWLEDGE_TASK_EXCERPT_MAX_CHARS,
  type KnowledgeTurnDTO,
  snapshotKnowledgeTaskMaterialOp,
  UiMode,
  WorkflowKind,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import { DEFAULT_START_WORKFLOW } from '../home/workflow-icon.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { workflowsQuery } from '../tasks/tasks.queries.ts';
import { citationLabel } from './answer.tsx';
import styles from './knowledge.module.css';

function TaskMaterialDialog({
  id,
  turn,
  answer,
  projectId,
  onClose,
}: {
  id: string;
  turn: KnowledgeTurnDTO;
  answer: string;
  projectId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const sourceId = useId();
  const workflowId = useId();
  const source = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({
    from: 0,
    to: Math.min(answer.length, KNOWLEDGE_TASK_EXCERPT_MAX_CHARS),
  });
  const [citations, setCitations] = useState(() => turn.citations.map((_, i) => i + 1));
  const [requirement, setRequirement] = useState(turn.question);
  const [workflow, setWorkflow] = useState(DEFAULT_START_WORKFLOW);
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  const workflows = useQuery(workflowsQuery);
  const available = workflows.data?.filter((flow) => pro || flow.kind === WorkflowKind.Builtin) ?? [];
  const preview = answer.slice(selection.from, selection.to);
  const valid = preview.trim() !== '' && selection.to - selection.from <= KNOWLEDGE_TASK_EXCERPT_MAX_CHARS;
  const create = useMutation({
    mutationFn: () => callOperation(snapshotKnowledgeTaskMaterialOp, { id, turnId: turn.id, ...selection, citations }),
    onSuccess: async (attachment) => {
      client.setQueryData(queryKeys.attachment(attachment.id), attachment);
      await navigate({
        to: ROUTES.home,
        search: { projectId, workflow, requirement: requirement.trim(), knowledgeMaterial: attachment.id },
      });
    },
  });

  return (
    <Dialog
      open
      title={C.startTask}
      description={C.materialHelp}
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button
            variant="primary"
            pending={create.isPending}
            disabled={!valid || requirement.trim() === '' || !available.some((flow) => flow.key === workflow)}
            onClick={() => create.mutate()}
          >
            {C.prepareTask}
          </Button>
        </>
      }
    >
      <div className="col">
        <label className="col" htmlFor={sourceId}>
          <span className="label">{C.answerText}</span>
          <textarea className="input" ref={source} id={sourceId} rows={3} readOnly value={answer} />
        </label>
        <div className="row wrap">
          <span className="hint grow">{C.selectionHelp(KNOWLEDGE_TASK_EXCERPT_MAX_CHARS)}</span>
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() => {
              if (source.current === null) return;
              const { selectionStart: from, selectionEnd: to } = source.current;
              setSelection({ from, to });
            }}
          >
            {C.useSelection}
          </Button>
        </div>
        <details className={styles.materialPreview}>
          <summary>{C.selectedConclusion}</summary>
          <pre>{valid ? preview : C.materialEmpty}</pre>
        </details>
        {!valid && <p className="hint">{C.materialEmpty}</p>}
        {turn.citations.length > 0 && (
          <fieldset className={styles.materialChoices} disabled={create.isPending}>
            <legend>{C.includeCitations}</legend>
            {turn.citations.map((citation, i) => {
              const number = i + 1;
              return (
                <label className="check" key={number}>
                  <input
                    type="checkbox"
                    checked={citations.includes(number)}
                    onChange={(e) => {
                      setCitations((old) =>
                        e.target.checked ? [...old, number] : old.filter((value) => value !== number),
                      );
                    }}
                  />
                  <span>
                    {C.citationMark(number)} · {citationLabel(citation)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <label className="col">
          <span className="label">{HOME_TASK_COPY.requirement}</span>
          <textarea
            className="input"
            rows={3}
            value={requirement}
            disabled={create.isPending}
            onChange={(e) => setRequirement(e.target.value)}
          />
        </label>
        <div className="col">
          <label htmlFor={workflowId} className="label">
            {HOME_TASK_COPY.workflow}
          </label>
          <select
            id={workflowId}
            className="select"
            value={workflow}
            disabled={create.isPending}
            onChange={(e) => setWorkflow(e.target.value)}
          >
            {available.map((flow) => (
              <option key={flow.key} value={flow.key}>
                {flow.name}
              </option>
            ))}
          </select>
        </div>
        {workflows.isError && <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />}
        {create.isError && <ErrorState error={create.error} />}
      </div>
    </Dialog>
  );
}

export function KnowledgeTaskAction(props: { id: string; turn: KnowledgeTurnDTO; answer: string; projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row">
      <Button size="sm" icon="sparkle" onClick={() => setOpen(true)}>
        {C.startTask}
      </Button>
      {open && <TaskMaterialDialog {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}
