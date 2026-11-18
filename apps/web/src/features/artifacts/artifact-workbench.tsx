import {
  API_PREFIX,
  ARTIFACT_NOTE_LIMIT,
  ARTIFACT_NOTES_MAX,
  type ArtifactNote,
  type ArtifactVersion,
  artifactDocumentKey,
  DeliveryStrategy,
  getTaskDocumentDraftOp,
  isWritingRepositoryDocument,
  latestDocumentVersions,
  type TaskDetailDTO,
  TaskStatus,
  WorkflowDeliverable,
} from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { callOperation, getBlob } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { saveBytes } from '../../app/save-file.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { IconButton } from '../../components/icon-button.tsx';
import { sizeReadingPane } from '../../components/reveal-in-pane.ts';
import { ARTIFACT_COPY, artifactAnchorLabel } from '../../copy/artifacts.ts';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { formatDateTime } from '../../copy/common.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import layout from '../preview/frontend-workbench.module.css';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { UnmetNotice, useDeliveryAcknowledgement } from '../requirements/unmet-notice.tsx';
import { useDeliver, useReviseTaskArtifact } from '../tasks/tasks.queries.ts';
import { ArtifactPreview, type ArtifactSelection, DocumentDraftPreview } from './artifact-preview.tsx';
import styles from './artifact-workbench.module.css';
import { DocumentNavigation } from './document-links.ts';

type DraftNote = ArtifactNote & { id: string };

type Panel = 'activity' | 'notes' | 'history' | 'record' | null;
type NodeDetails = { title: string; content: ReactNode; onClose: () => void };

export function ArtifactWorkbench({
  task,
  artifact,
  active,
  selectedVersion,
  onSelectVersion,
  record,
  nodeDetails,
  onOpenNode,
  renderDelivery,
}: {
  task: TaskDetailDTO;
  active: boolean;
  artifact: NonNullable<TaskDetailDTO['artifact']>;
  selectedVersion: string | undefined;
  onSelectVersion: (id: string | undefined) => void;
  record: ReactNode;
  nodeDetails?: NodeDetails | undefined;
  onOpenNode: (id: string) => void;
  renderDelivery?: (version: ArtifactVersion, disabled: boolean) => ReactNode;
}) {
  const [chosenPanel, setPanel] = useState<Panel>();
  const repositoryDocument = task.workflow.deliverable === WorkflowDeliverable.CodeChanges;
  const writing = repositoryDocument ? task.nodes.find(isWritingRepositoryDocument) : undefined;
  const documents = latestDocumentVersions(artifact.versions);
  const pinned = artifact.versions.find((v) => v.id === selectedVersion);
  const [target, setTarget] = useState<{ path: string; fragment: string }>();
  const [draftPin, setDraftPin] = useState<{ nodeId: string; path: string }>();
  const pinnedDraft = draftPin && draftPin.nodeId === writing?.id ? draftPin.path : undefined;
  const document = useQuery({
    queryKey: ['task-document-draft', task.id, writing?.id, pinnedDraft],
    placeholderData: (previous, query) => (query?.queryKey[2] === writing?.id ? previous : undefined),
    enabled: active && writing !== undefined && selectedVersion === undefined,
    queryFn: () => callOperation(getTaskDocumentDraftOp, { id: task.id, nodeId: writing?.id ?? '', path: pinnedDraft }),
    refetchInterval: active && task.status === TaskStatus.Running && writing !== undefined ? 2000 : false,
  });
  const workingDraft = writing && selectedVersion === undefined ? document.data?.draft : undefined;
  const followDraft = pinnedDraft === undefined;
  const panel =
    chosenPanel === undefined ? (task.openInbox.length > 0 || workingDraft ? 'activity' : null) : chosenPanel;
  const [draft, setDraft] = useState<{ versionId: string; notes: DraftNote[] }>();
  const [selection, setSelection] = useState<ArtifactSelection>();
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState(false);
  const newest = artifact.versions.at(-1);
  const selectedFile = pinned ? artifactDocumentKey(pinned) : newest && artifactDocumentKey(newest);
  const versions = artifact.versions.filter((v) => artifactDocumentKey(v) === selectedFile);
  const latest = versions.at(-1);
  const version = workingDraft
    ? undefined
    : selectedVersion === undefined
      ? latest
      : artifact.versions.find(({ id }) => id === selectedVersion);
  const missingVersion = selectedVersion !== undefined && version === undefined;
  const previous = version === undefined ? undefined : versions[versions.indexOf(version) - 1];
  const notes = draft !== undefined && draft.versionId === version?.id ? draft.notes : [];
  const review = task.status === TaskStatus.Review;
  const canNote = review && version !== undefined && version.id === latest?.id;
  const building =
    !workingDraft &&
    latest === undefined &&
    [TaskStatus.Preparing, TaskStatus.Running].some((status) => status === task.status);
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
          onSelectVersion(undefined);
          setCompare(false);
        },
      },
    );
  }

  function choose(id: string) {
    setTarget(undefined);
    onSelectVersion(id === '' || (!writing && id === newest?.id) ? undefined : id);
    setSelection(undefined);
    setNote('');
    setCompare(false);
  }

  const pendingNotes = notes.length > 0 || note.trim() !== '' || revision.isPending;
  const sidebar = nodeDetails !== undefined || (!building && panel !== null);
  const workbench = (
    <section className={layout.workbench} data-testid="artifact-workbench" aria-label={ARTIFACT_COPY.workbench}>
      <header className={layout.toolbar}>
        <div className={styles.file}>
          <div className={styles.documentTitle}>
            {documents.size > 1 && (
              <label className={styles.documentTitle}>
                <span className="hint">{ARTIFACT_COPY.selectFile}</span>
                <select
                  className="input"
                  aria-label={ARTIFACT_COPY.selectFile}
                  value={workingDraft ? '' : selectedFile}
                  onChange={(event) => {
                    const target = documents.get(event.currentTarget.value);
                    choose(target?.id ?? '');
                  }}
                >
                  {writing && <option value="">{ARTIFACT_COPY.workingDraft}</option>}
                  {Array.from(documents, ([key, file]) => (
                    <option key={key} value={key}>
                      {file.repository?.path ?? file.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(workingDraft || documents.size < 2) && (
              <strong>{workingDraft ? ARTIFACT_COPY.workingDraft : (version?.name ?? ARTIFACT_COPY.file)}</strong>
            )}
            {workingDraft && <span className="mono hint">{workingDraft.path}</span>}
            {documents.size < 2 && version?.repository !== undefined && (
              <span className="mono hint" title={version.repository.commit}>
                {version.repository.path}
              </span>
            )}
          </div>
          {(version || (workingDraft && latest)) && (
            <select
              className="input"
              aria-label={ARTIFACT_COPY.version}
              value={version?.id ?? ''}
              onChange={(event) => choose(event.currentTarget.value)}
            >
              {writing && <option value="">{ARTIFACT_COPY.workingDraft}</option>}
              {[...versions].reverse().map((file) => (
                <option key={file.id} value={file.id}>
                  v{file.number}
                  {file.id === latest?.id ? ARTIFACT_COPY.latest : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {workingDraft && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={followDraft}
            onClick={() =>
              setDraftPin(followDraft && writing ? { nodeId: writing.id, path: workingDraft.path } : undefined)
            }
          >
            {followDraft ? R.followEdit : R.resumeEdit}
          </Button>
        )}
        {version && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={selectedVersion === undefined}
            onClick={() => onSelectVersion(selectedVersion === undefined ? version.id : undefined)}
          >
            {selectedVersion === undefined ? R.followEdit : R.resumeEdit}
          </Button>
        )}
        {!building && (
          <Button
            size="sm"
            icon="gauge"
            variant="ghost"
            aria-expanded={panel === 'activity'}
            onClick={() => show('activity')}
          >
            {ARTIFACT_COPY.panels.activity}
          </Button>
        )}
        <Button
          size="sm"
          icon="edit"
          aria-expanded={panel === 'notes'}
          disabled={!canNote}
          onClick={() => show('notes')}
        >
          {ARTIFACT_COPY.panels.notes}
        </Button>
        <Button
          size="sm"
          icon="clock"
          variant="ghost"
          aria-expanded={panel === 'history'}
          disabled={version === undefined}
          onClick={() => show('history')}
        >
          {ARTIFACT_COPY.panels.history}
        </Button>
        <Button size="sm" icon="list" variant="ghost" aria-expanded={panel === 'record'} onClick={() => show('record')}>
          {ARTIFACT_COPY.panels.record}
        </Button>
        {version !== undefined && (
          <Button size="sm" variant="ghost" pending={save.isPending} onClick={() => save.mutate(version)}>
            {ARTIFACT_COPY.save}
          </Button>
        )}
        {version !== undefined && (
          <Link to={ROUTES.pptNew} search={{ taskId: task.id, artifactVersionId: version.id }} className="btn ghost sm">
            {PPT_COPY.makeDeck}
          </Link>
        )}
        {review && renderDelivery !== undefined && version !== undefined
          ? renderDelivery(newest ?? version, !canNote || pendingNotes)
          : review &&
            renderDelivery === undefined && (
              <Button
                size="sm"
                variant="primary"
                icon="check"
                pending={delivery.isPending}
                disabled={!canNote || acknowledgement.blocked || pendingNotes}
                onClick={() =>
                  delivery.mutate({ id: task.id, strategy: DeliveryStrategy.ReportOnly, ...acknowledgement.ack })
                }
              >
                {ARTIFACT_COPY.accept}
              </Button>
            )}
      </header>
      {active && writing && selectedVersion === undefined && document.isError && <ErrorState error={document.error} />}
      {save.isError && <ErrorState error={save.error} />}
      {delivery.isError && <ErrorState error={delivery.error} />}
      {review && renderDelivery === undefined && <UnmetNotice acknowledgement={acknowledgement} />}
      <div className={layout.body}>
        <div className={styles.stage}>
          {workingDraft ? (
            <DocumentDraftPreview key={workingDraft.path} draft={workingDraft} follow={active && followDraft} />
          ) : version !== undefined ? (
            <div className={compare && previous !== undefined ? styles.comparison : 'col'}>
              {compare && previous !== undefined && (
                <section
                  aria-label={ARTIFACT_COPY.beforeLabel(previous.number)}
                  ref={sizeReadingPane}
                  className={styles.reader}
                >
                  <h3>{ARTIFACT_COPY.before(previous.number)}</h3>
                  <ArtifactPreview key={previous.id} taskId={task.id} version={previous} />
                </section>
              )}
              <section
                aria-label={ARTIFACT_COPY.previewLabel(version.number)}
                ref={sizeReadingPane}
                className={styles.reader}
              >
                {compare && previous !== undefined && <h3>{ARTIFACT_COPY.after(version.number)}</h3>}
                {version.lost.length > 0 && <p className="hint">{ASSISTANT_COPY.file.lost(version.lost)}</p>}
                <ArtifactPreview
                  key={version.id}
                  taskId={task.id}
                  follow={active && selectedVersion === undefined && !compare && panel !== 'notes'}
                  previous={previous}
                  version={version}
                  onPick={canNote && panel === 'notes' && !compare ? pick : undefined}
                />
              </section>
            </div>
          ) : missingVersion ? (
            <div className="col">
              <p className="hint">{PPT_COPY.artifactMissing}</p>
              {latest !== undefined && (
                <Button size="sm" onClick={() => choose(latest.id)}>
                  {ARTIFACT_COPY.openLatest}
                </Button>
              )}
            </div>
          ) : building ? (
            <FrontendActivity
              task={task}
              inMain
              starting={false}
              buildingTitle={repositoryDocument ? ARTIFACT_COPY.awaitingDraft : ARTIFACT_COPY.building}
              buildingHint={repositoryDocument ? ARTIFACT_COPY.awaitingDraftHint : ARTIFACT_COPY.buildingHint}
            />
          ) : (
            <div className="col">
              <p className="hint">{ARTIFACT_COPY.empty}</p>
              {record}
            </div>
          )}
        </div>
        {sidebar && (
          <aside
            className={layout.inspector}
            aria-label={nodeDetails?.title ?? (panel === null ? '' : ARTIFACT_COPY.panels[panel])}
          >
            <div className={layout.inspectorHead}>
              <h2>{nodeDetails?.title ?? (panel === null ? '' : ARTIFACT_COPY.panels[panel])}</h2>
              <IconButton
                icon="x"
                label={ARTIFACT_COPY.closeSidebar}
                onClick={nodeDetails?.onClose ?? (() => setPanel(null))}
              />
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
                    {compare ? ARTIFACT_COPY.closeCompare : ARTIFACT_COPY.compare}
                  </Button>
                )}
                <ol className={styles.history}>
                  {[...versions].reverse().map((file) => (
                    <li key={file.id}>
                      <Button size="sm" aria-pressed={file.id === version.id} onClick={() => choose(file.id)}>
                        v{file.number} · {formatDateTime(file.createdAt)}
                      </Button>
                      {artifact.rounds
                        .filter(
                          (round) => round.nodeId === file.nodeId && versions.some((v) => v.id === round.versionId),
                        )
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
                        {ARTIFACT_COPY.viewActivity}
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            ) : panel === 'notes' && version !== undefined ? (
              <>
                <p className="hint">{canNote ? ARTIFACT_COPY.pickHint : ARTIFACT_COPY.reviewHint}</p>
                {selection !== undefined && canNote && (
                  <div className={layout.note}>
                    <strong>{artifactAnchorLabel(selection.anchor)}</strong>
                    {selection.quote && <blockquote className={styles.quote}>{selection.quote}</blockquote>}
                    <label className="field">
                      {ARTIFACT_COPY.note}
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
                        {ARTIFACT_COPY.add}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelection(undefined);
                          setNote('');
                        }}
                      >
                        {ARTIFACT_COPY.cancel}
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
                        label={ARTIFACT_COPY.removeNote(i + 1)}
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
                  {ARTIFACT_COPY.wholeFile}
                </Button>
                {revision.isError && <ErrorState error={revision.error} />}
                <Button
                  variant="primary"
                  icon="sparkle"
                  pending={revision.isPending}
                  disabled={!canNote || notes.length === 0 || note.trim() !== ''}
                  onClick={() => send(version.id)}
                >
                  {ARTIFACT_COPY.submit}
                </Button>
              </>
            ) : null}
          </aside>
        )}
      </div>
      {(review || task.status === TaskStatus.Completed) && <RequirementsSection task={task} />}
    </section>
  );
  return (
    <DocumentNavigation.Provider
      value={{
        paths: new Set(Array.from(documents.values(), (v) => v.repository?.path ?? v.name)),
        open: (path, fragment) => {
          const file = Array.from(documents.values()).find((v) => (v.repository?.path ?? v.name) === path);
          if (file) {
            choose(file.id);
            setTarget({ path, fragment });
          }
        },
        target,
      }}
    >
      {workbench}
    </DocumentNavigation.Provider>
  );
}
