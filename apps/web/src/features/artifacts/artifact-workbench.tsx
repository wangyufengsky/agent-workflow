import {
  API_PREFIX,
  ARTIFACT_NOTE_LIMIT,
  ARTIFACT_NOTES_MAX,
  type ArtifactNote,
  type ArtifactVersion,
  artifactAnchorLabel,
  DeliveryStrategy,
  type TaskDetailDTO,
  TaskStatus,
} from '@aw/shared';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { getBlob } from '../../api/client.ts';
import { saveBytes } from '../../app/save-file.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { formatDateTime } from '../../copy/common.ts';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import layout from '../preview/frontend-workbench.module.css';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { UnmetNotice, useDeliveryAcknowledgement } from '../requirements/unmet-notice.tsx';
import { useDeliver, useReviseTaskArtifact } from '../tasks/tasks.queries.ts';
import { ArtifactPreview, type ArtifactSelection } from './artifact-preview.tsx';
import styles from './artifact-workbench.module.css';

type DraftNote = ArtifactNote & { id: string };

type Panel = 'activity' | 'notes' | 'history' | 'record' | null;
type NodeDetails = { title: string; content: ReactNode; onClose: () => void };

const PANELS = {
  activity: 'AI 活动',
  notes: '标注修改',
  history: '版本记录',
  record: '任务记录',
} as const;

export function ArtifactWorkbench({
  task,
  artifact,
  record,
  nodeDetails,
  onOpenNode,
}: {
  task: TaskDetailDTO;
  artifact: NonNullable<TaskDetailDTO['artifact']>;
  record: ReactNode;
  nodeDetails?: NodeDetails | undefined;
  onOpenNode: (id: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>('activity');
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [draft, setDraft] = useState<{ versionId: string; notes: DraftNote[] }>();
  const [selection, setSelection] = useState<ArtifactSelection>();
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState(false);
  const latest = artifact.versions.at(-1);
  const version = artifact.versions.find(({ id }) => id === selectedVersion) ?? latest;
  const previous = version === undefined ? undefined : artifact.versions[artifact.versions.indexOf(version) - 1];
  const notes = draft !== undefined && draft.versionId === version?.id ? draft.notes : [];
  const review = task.status === TaskStatus.Review;
  const canNote = review && version !== undefined && version.id === latest?.id;
  const building =
    latest === undefined && [TaskStatus.Preparing, TaskStatus.Running].some((status) => status === task.status);
  const revision = useReviseTaskArtifact();
  const delivery = useDeliver();
  const acknowledgement = useDeliveryAcknowledgement(task.id);
  const save = useMutation({
    async mutationFn(file: ArtifactVersion) {
      const raw = await getBlob(`${API_PREFIX}/tasks/${task.id}/artifacts/${file.id}/raw`);
      return saveBytes(file.name, new Uint8Array(await raw.arrayBuffer()));
    },
  });

  function show(next: Panel) {
    if (next === 'notes') setCompare(false);
    nodeDetails?.onClose();
    setPanel(next === panel && nodeDetails === undefined ? null : next);
  }

  function pick(value: ArtifactSelection) {
    if (note.trim() !== '' && selection !== undefined) return;
    setSelection(value);
    setPanel('notes');
  }

  function add(versionId: string) {
    if (selection === undefined || note.trim() === '' || notes.length >= ARTIFACT_NOTES_MAX) return;
    setDraft({ versionId, notes: [...notes, { ...selection, note: note.trim(), id: crypto.randomUUID() }] });
    setSelection(undefined);
    setNote('');
  }

  function send(versionId: string) {
    revision.mutate(
      { id: task.id, versionId, notes: notes.map(({ id: _id, ...item }) => item) },
      {
        onSuccess: () => {
          setPanel('activity');
          setDraft(undefined);
          setSelectedVersion(undefined);
          setCompare(false);
        },
      },
    );
  }

  function choose(id: string) {
    setSelectedVersion(id === latest?.id ? undefined : id);
    setSelection(undefined);
    setNote('');
    setCompare(false);
  }

  const sidebar = nodeDetails !== undefined || (!building && panel !== null);
  return (
    <section className={layout.workbench} data-testid="artifact-workbench" aria-label="产物工作台">
      <header className={layout.toolbar}>
        <div className={styles.file}>
          <strong>{version?.name ?? '任务产物'}</strong>
          {version !== undefined && (
            <select
              className="input"
              aria-label="产物版本"
              value={version.id}
              onChange={(event) => choose(event.currentTarget.value)}
            >
              {[...artifact.versions].reverse().map((file) => (
                <option key={file.id} value={file.id}>
                  v{file.number}
                  {file.id === latest?.id ? ' · 最新' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {!building && (
          <Button
            size="sm"
            icon="gauge"
            variant="ghost"
            aria-expanded={panel === 'activity'}
            onClick={() => show('activity')}
          >
            {PANELS.activity}
          </Button>
        )}
        <Button
          size="sm"
          icon="edit"
          aria-expanded={panel === 'notes'}
          disabled={!canNote}
          onClick={() => show('notes')}
        >
          {PANELS.notes}
        </Button>
        <Button
          size="sm"
          icon="clock"
          variant="ghost"
          aria-expanded={panel === 'history'}
          disabled={version === undefined}
          onClick={() => show('history')}
        >
          {PANELS.history}
        </Button>
        <Button size="sm" icon="list" variant="ghost" aria-expanded={panel === 'record'} onClick={() => show('record')}>
          {PANELS.record}
        </Button>
        {version !== undefined && (
          <Button size="sm" variant="ghost" pending={save.isPending} onClick={() => save.mutate(version)}>
            保存原件
          </Button>
        )}
        {review && (
          <Button
            size="sm"
            variant="primary"
            icon="check"
            pending={delivery.isPending}
            disabled={
              !canNote || acknowledgement.blocked || notes.length > 0 || note.trim() !== '' || revision.isPending
            }
            onClick={() =>
              delivery.mutate({ id: task.id, strategy: DeliveryStrategy.ReportOnly, ...acknowledgement.ack })
            }
          >
            验收产物
          </Button>
        )}
      </header>
      {save.isError && <ErrorState error={save.error} />}
      {delivery.isError && <ErrorState error={delivery.error} />}
      {review && <UnmetNotice acknowledgement={acknowledgement} />}
      <div className={layout.body}>
        <div className={styles.stage}>
          {version !== undefined ? (
            <div className={compare && previous !== undefined ? styles.comparison : 'col'}>
              {compare && previous !== undefined && (
                <section aria-label={`改前 v${previous.number}`} className="col">
                  <h3>改前 · v{previous.number}</h3>
                  <ArtifactPreview key={previous.id} taskId={task.id} version={previous} />
                </section>
              )}
              <section aria-label={`产物预览 v${version.number}`} className="col">
                {compare && previous !== undefined && <h3>改后 · v{version.number}</h3>}
                {version.lost.length > 0 && <p className="hint">{ASSISTANT_COPY.file.lost(version.lost)}</p>}
                <ArtifactPreview
                  key={version.id}
                  taskId={task.id}
                  version={version}
                  onPick={canNote && panel === 'notes' && !compare ? pick : undefined}
                />
              </section>
            </div>
          ) : building ? (
            <FrontendActivity
              task={task}
              inMain
              starting={false}
              buildingTitle="正在生成首版产物"
              buildingHint="首个文件发布后会自动打开预览。"
            />
          ) : (
            <div className="col">
              <p className="hint">还没有可查看的文件。</p>
              {record}
            </div>
          )}
        </div>
        {sidebar && (
          <aside className={layout.inspector} aria-label={nodeDetails?.title ?? (panel === null ? '' : PANELS[panel])}>
            <div className={layout.inspectorHead}>
              <h2>{nodeDetails?.title ?? (panel === null ? '' : PANELS[panel])}</h2>
              <IconButton icon="x" label="收起侧栏" onClick={nodeDetails?.onClose ?? (() => setPanel(null))} />
            </div>
            {nodeDetails !== undefined ? (
              nodeDetails.content
            ) : panel === 'activity' ? (
              <FrontendActivity task={task} inMain={false} starting={false} />
            ) : panel === 'record' ? (
              record
            ) : panel === 'history' && version !== undefined ? (
              <>
                {previous !== undefined && (
                  <Button size="sm" aria-pressed={compare} onClick={() => setCompare(!compare)}>
                    {compare ? '关闭对照' : '对照上一版'}
                  </Button>
                )}
                <ol className={styles.history}>
                  {[...artifact.versions].reverse().map((file) => (
                    <li key={file.id}>
                      <Button size="sm" aria-pressed={file.id === version.id} onClick={() => choose(file.id)}>
                        v{file.number} · {formatDateTime(file.createdAt)}
                      </Button>
                      {artifact.rounds
                        .filter((round) => round.nodeId === file.nodeId)
                        .flatMap(({ notes }) =>
                          notes.map((item) => (
                            <div key={item.id} className={layout.note}>
                              <strong>{artifactAnchorLabel(item.anchor)}</strong>
                              <p>{item.note}</p>
                              {item.quote && <blockquote>{item.quote}</blockquote>}
                            </div>
                          )),
                        )}
                      <Button size="sm" variant="ghost" onClick={() => onOpenNode(file.nodeId)}>
                        查看执行过程
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            ) : panel === 'notes' && version !== undefined ? (
              <>
                <p className="hint">
                  {canNote ? '在预览中选中内容。按住 Shift 可选择多行或单元格区域。' : '在最新版本待查看时可提交意见。'}
                </p>
                {selection !== undefined && canNote && (
                  <div className={layout.note}>
                    <strong>{artifactAnchorLabel(selection.anchor)}</strong>
                    {selection.quote && <blockquote className={styles.quote}>{selection.quote}</blockquote>}
                    <label className="field">
                      怎么修改
                      <textarea
                        className="input"
                        rows={3}
                        maxLength={ARTIFACT_NOTE_LIMIT}
                        value={note}
                        onChange={(event) => setNote(event.currentTarget.value)}
                      />
                    </label>
                    <div className="row wrap">
                      <Button
                        size="sm"
                        disabled={note.trim() === '' || notes.length >= ARTIFACT_NOTES_MAX}
                        onClick={() => add(version.id)}
                      >
                        加入本轮
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelection(undefined);
                          setNote('');
                        }}
                      >
                        取消标注
                      </Button>
                    </div>
                  </div>
                )}
                {notes.map((item, i) => (
                  <div className={layout.note} key={item.id}>
                    <div className={layout.inspectorHead}>
                      <strong>{artifactAnchorLabel(item.anchor)}</strong>
                      <IconButton
                        icon="x"
                        label={`移除第 ${i + 1} 条意见`}
                        onClick={() => setDraft({ versionId: version.id, notes: notes.filter((_, j) => j !== i) })}
                      />
                    </div>
                    <p>{item.note}</p>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canNote}
                  onClick={() => pick({ anchor: { kind: 'whole' }, quote: '' })}
                >
                  整份文件意见
                </Button>
                {revision.isError && <ErrorState error={revision.error} />}
                <Button
                  variant="primary"
                  icon="sparkle"
                  pending={revision.isPending}
                  disabled={!canNote || notes.length === 0 || note.trim() !== ''}
                  onClick={() => send(version.id)}
                >
                  交给 AI 修改
                </Button>
              </>
            ) : null}
          </aside>
        )}
      </div>
      {(review || task.status === TaskStatus.Completed) && <RequirementsSection task={task} />}
    </section>
  );
}
