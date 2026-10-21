import {
  type DeckMaterialInput,
  DeckMaterialKind,
  KnowledgeTurnStatus,
  type ProjectDTO,
  TaskDisplayGroup,
} from '@aw/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Icon, type IconName } from '../../components/icon.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { knowledgeConversationQuery, knowledgePagesQuery } from '../knowledge/knowledge.queries.ts';
import { taskQuery, tasksQuery } from '../tasks/tasks.queries.ts';
import styles from './ppt.module.css';

/** Tasks with a result to make a PPT of (23 §2.3). */
const WITH_RESULT: readonly string[] = [TaskDisplayGroup.Review, TaskDisplayGroup.Completed];
/** Files read as text in the renderer; the backend takes no uploads (D95 ④). */
const TEXT_FILES =
  '.md,.markdown,.txt,.csv,.json,.yaml,.yml,.xml,.html,.ts,.tsx,.js,.jsx,.java,.kt,.go,.py,.rs,.sql,.sh';

type Adding = 'task' | 'knowledge' | 'text' | null;

const KIND_ICON: Record<DeckMaterialKind, IconName> = {
  [DeckMaterialKind.Text]: 'file',
  [DeckMaterialKind.File]: 'file',
  [DeckMaterialKind.Task]: 'list',
  [DeckMaterialKind.Knowledge]: 'book',
};

/** The material's name: a task or conversation is looked up for its title. */
function MaterialTitle({ material }: { material: DeckMaterialInput }) {
  const task = useQuery({
    ...taskQuery(material.kind === DeckMaterialKind.Task ? material.taskId : ''),
    enabled: material.kind === DeckMaterialKind.Task,
  });
  const conversation = useQuery({
    ...knowledgeConversationQuery(material.kind === DeckMaterialKind.Knowledge ? material.conversationId : ''),
    enabled: material.kind === DeckMaterialKind.Knowledge,
  });
  switch (material.kind) {
    case DeckMaterialKind.Text:
      return <>{material.content.trim().split('\n')[0]}</>;
    case DeckMaterialKind.File:
      return <>{material.title}</>;
    case DeckMaterialKind.Task:
      return <>{task.data === undefined ? '…' : `${task.data.key} · ${task.data.title}`}</>;
    case DeckMaterialKind.Knowledge:
      return <>{conversation.data?.title ?? '…'}</>;
  }
}

function TaskPicker({ projectId, onPick }: { projectId: string; onPick(taskId: string): void }) {
  const tasks = (useQuery(tasksQuery({ projectId })).data ?? []).filter((t) => WITH_RESULT.includes(t.displayGroup));
  if (tasks.length === 0) return <p className="hint">{C.noTasks}</p>;
  return (
    <select className="select" aria-label={C.pickTask} value="" onChange={(e) => onPick(e.target.value)}>
      <option value="">{C.pickTask}</option>
      {tasks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.key} · {t.title}
        </option>
      ))}
    </select>
  );
}

function KnowledgePicker({ projectId, onPick }: { projectId: string; onPick(conversationId: string): void }) {
  const pages = useInfiniteQuery(knowledgePagesQuery({ projectId }));
  const conversations = (pages.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (c) => c.latest.status === KnowledgeTurnStatus.Answered,
  );
  if (conversations.length === 0) return <p className="hint">{C.noKnowledge}</p>;
  return (
    <select className="select" aria-label={C.pickKnowledge} value="" onChange={(e) => onPick(e.target.value)}>
      <option value="">{C.pickKnowledge}</option>
      {conversations.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}

function TextAdder({ onAdd, onCancel }: { onAdd(material: DeckMaterialInput): void; onCancel(): void }) {
  const [text, setText] = useState('');
  return (
    <div className={styles.adder}>
      <textarea
        className="textarea"
        rows={5}
        aria-label={C.pasteTitle}
        placeholder={C.pastePlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <label className="btn ghost sm">
          <Icon name="file" size="sm" />
          {C.pickFile}
          <input
            className="sr"
            type="file"
            accept={TEXT_FILES}
            multiple
            onChange={(e) => {
              for (const file of e.target.files ?? []) {
                void file.text().then((content) => onAdd({ kind: DeckMaterialKind.File, title: file.name, content }));
              }
            }}
          />
        </label>
        <span className="hint grow">{C.fileHint}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {C.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={text.trim() === ''}
          onClick={() => onAdd({ kind: DeckMaterialKind.Text, content: text })}
        >
          {C.add}
        </Button>
      </div>
    </div>
  );
}

/**
 * The PPT's material (23 §2.3): a project whose code the AI may read, task results, knowledge conversations of that
 * project, pasted text and text files. Material from a project fixes the project.
 */
export function MaterialsPicker({
  projects,
  projectId,
  projectLocked,
  materials,
  onProject,
  onChange,
}: {
  projects: readonly ProjectDTO[];
  projectId: string | null;
  projectLocked: boolean;
  materials: readonly DeckMaterialInput[];
  onProject(projectId: string | null): void;
  onChange(materials: DeckMaterialInput[]): void;
}) {
  const [adding, setAdding] = useState<Adding>(null);
  const add = (material: DeckMaterialInput) => {
    onChange([...materials, material]);
    setAdding(null);
  };
  const toggle = (next: Exclude<Adding, null>) => setAdding(adding === next ? null : next);
  return (
    <div className="field">
      <span className="label">{C.materials}</span>
      <div className={styles.materialBar}>
        <select
          className="select"
          aria-label={C.addProject}
          value={projectId ?? ''}
          disabled={projectLocked}
          title={projectLocked ? C.projectLocked : undefined}
          onChange={(e) => onProject(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">{C.noProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button size="sm" icon="list" disabled={projectId === null} onClick={() => toggle('task')}>
          {C.addTask}
        </Button>
        <Button size="sm" icon="book" disabled={projectId === null} onClick={() => toggle('knowledge')}>
          {C.addKnowledge}
        </Button>
        <Button size="sm" icon="file" onClick={() => toggle('text')}>
          {C.addText}
        </Button>
      </div>
      {adding === 'task' && projectId !== null && (
        <TaskPicker projectId={projectId} onPick={(taskId) => add({ kind: DeckMaterialKind.Task, taskId })} />
      )}
      {adding === 'knowledge' && projectId !== null && (
        <KnowledgePicker
          projectId={projectId}
          onPick={(conversationId) => add({ kind: DeckMaterialKind.Knowledge, conversationId })}
        />
      )}
      {adding === 'text' && <TextAdder onAdd={add} onCancel={() => setAdding(null)} />}
      {(projectId !== null || materials.length > 0) && (
        <ul className={styles.materials} aria-label={C.materials}>
          {projectId !== null && (
            <li className={styles.material}>
              <Icon name="folder" size="sm" />
              <span className="ellipsis">{projects.find((p) => p.id === projectId)?.name}</span>
              <span className="hint">{C.projectCode}</span>
            </li>
          )}
          {materials.map((material, i) => (
            // Materials are only appended and removed; their position is their identity here.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i} className={styles.material}>
              <Icon name={KIND_ICON[material.kind]} size="sm" />
              <span className="ellipsis">
                <MaterialTitle material={material} />
              </span>
              <span className="hint">{C.materialKind[material.kind]}</span>
              <IconButton
                icon="x"
                label={C.remove(C.materialKind[material.kind])}
                onClick={() => onChange(materials.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      )}
      <span className="hint">{C.materialsHint}</span>
    </div>
  );
}
