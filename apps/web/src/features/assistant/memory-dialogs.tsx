import {
  ASSISTANT_MEMORY_MAX_CHARS,
  type AssistantMemoryDTO,
  createAssistantMemoryOp,
  deleteAssistantMemoryOp,
  type ProjectDTO,
  updateAssistantMemoryOp,
} from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { MEMORY_COPY as C } from '../../copy/assistant.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import styles from './memory-page.module.css';

export function MemoryEditor({
  memory,
  projects,
  onClose,
  onSaved,
}: {
  memory: AssistantMemoryDTO | null;
  projects: readonly ProjectDTO[];
  onClose(): void;
  onSaved(id: string): void;
}) {
  const id = useId();
  const [content, setContent] = useState(memory?.content ?? '');
  const [projectId, setProjectId] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      memory === null
        ? callOperation(createAssistantMemoryOp, { projectId: projectId || null, content })
        : callOperation(updateAssistantMemoryOp, { id: memory.id, content }),
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: queryKeys.assistantMemories });
      onSaved(saved.id);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={memory === null ? C.add : C.edit}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button type="submit" form={id} variant="primary" pending={save.isPending} disabled={content.trim() === ''}>
            {COMMON_COPY.save}
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending && content.trim() !== '') save.mutate();
        }}
      >
        {memory === null && (
          <div className="field">
            <label htmlFor={`${id}-scope`} className="label">
              {C.scope}
            </label>
            <select
              id={`${id}-scope`}
              className="input"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{C.personal}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-content`} className="label">
            {C.content}
          </label>
          <textarea
            id={`${id}-content`}
            className="input"
            rows={4}
            maxLength={ASSISTANT_MEMORY_MAX_CHARS}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
          />
        </div>
        {save.isError && <ErrorState error={save.error} />}
      </form>
    </Dialog>
  );
}

export function DeleteMemoryDialog({ memory, onClose }: { memory: AssistantMemoryDTO; onClose(): void }) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => callOperation(deleteAssistantMemoryOp, { id: memory.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.assistantMemories });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
      title={C.remove}
      footer={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button variant="danger" pending={remove.isPending} onClick={() => remove.mutate()}>
            {C.remove}
          </Button>
        </>
      }
    >
      <p>{C.removePrompt}</p>
      <p className={styles.content}>{memory.content}</p>
      {remove.isError && <ErrorState error={remove.error} />}
    </Dialog>
  );
}
