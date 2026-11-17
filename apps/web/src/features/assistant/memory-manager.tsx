import {
  ASSISTANT_MEMORY_MAX_CHARS,
  type AssistantMemoryDTO,
  createAssistantMemoryOp,
  deleteAssistantMemoryOp,
  listAssistantMemoriesOp,
  updateAssistantMemoryOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { MEMORY_COPY as C } from '../../copy/assistant.ts';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './memory-manager.module.css';

function ProjectOptions() {
  const projects = useQuery(projectsQuery);
  return projects.data?.map((project) => (
    <option key={project.id} value={project.id}>
      {project.name}
    </option>
  ));
}

function MemoryEditor({ memory, onClose }: { memory: AssistantMemoryDTO | null; onClose: () => void }) {
  const id = useId();
  const [content, setContent] = useState(memory?.content ?? '');
  const [projectId, setProjectId] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      memory === null
        ? callOperation(createAssistantMemoryOp, { projectId: projectId || null, content })
        : callOperation(updateAssistantMemoryOp, { id: memory.id, content }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.assistantMemories });
      onClose();
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
          save.mutate();
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
              <ProjectOptions />
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

export function MemoryManager() {
  const [scope, setScope] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssistantMemoryDTO | null>();
  const [deleting, setDeleting] = useState<AssistantMemoryDTO>();
  const client = useQueryClient();
  const projects = useQuery(projectsQuery);
  const memories = useQuery({
    queryKey: queryKeys.assistantMemories,
    queryFn: async () => (await callOperation(listAssistantMemoriesOp, {})).items,
  });
  const remove = useMutation({
    mutationFn: (id: string) => callOperation(deleteAssistantMemoryOp, { id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.assistantMemories });
      setDeleting(undefined);
    },
  });
  const items = memories.data?.filter((memory) => scope === null || scope === (memory.projectId ?? ''));
  return (
    <Panel
      title={C.title}
      actions={
        <Button size="sm" onClick={() => setEditing(null)}>
          {C.add}
        </Button>
      }
    >
      <p className="hint">{C.description}</p>
      <label className={styles.filter}>
        {C.scope}
        <select
          className="input"
          value={scope === null ? 'all' : scope}
          onChange={(event) => setScope(event.target.value === 'all' ? null : event.target.value)}
        >
          <option value="all">{C.all}</option>
          <option value="">{C.personal}</option>
          <ProjectOptions />
        </select>
      </label>
      {memories.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {memories.isError && <ErrorState error={memories.error} onRetry={() => void memories.refetch()} />}
      {items?.length === 0 && <p className="hint">{C.empty}</p>}
      {items !== undefined && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((memory) => (
            <li key={memory.id} className={styles.entry}>
              <p className={styles.content}>{memory.content}</p>
              <div className={styles.details}>
                <span className="hint">
                  {memory.projectId === null
                    ? C.personal
                    : (projects.data?.find((project) => project.id === memory.projectId)?.name ?? memory.projectId)}
                  {' · '}
                  {formatDateTime(memory.updatedAt)}
                </span>
                {memory.sourceConversationId !== null && (
                  <Link to={ROUTES.home} search={{ conversation: memory.sourceConversationId }}>
                    {C.source}
                  </Link>
                )}
              </div>
              <div className={styles.details}>
                <Button size="sm" onClick={() => setEditing(memory)}>
                  {C.edit}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    remove.reset();
                    setDeleting(memory);
                  }}
                >
                  {C.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && <MemoryEditor memory={editing} onClose={() => setEditing(undefined)} />}
      {deleting !== undefined && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(undefined);
          }}
          title={C.remove}
          footer={
            <>
              <Button onClick={() => setDeleting(undefined)} disabled={remove.isPending}>
                {COMMON_COPY.cancel}
              </Button>
              <Button variant="danger" pending={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {C.remove}
              </Button>
            </>
          }
        >
          <p>{C.removePrompt}</p>
          <p className={styles.content}>{deleting.content}</p>
          {remove.isError && <ErrorState error={remove.error} />}
        </Dialog>
      )}
    </Panel>
  );
}
