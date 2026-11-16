import {
  AttemptStatus,
  getTaskTimelineOp,
  NodeEvent,
  previewConventionEvidenceOp,
  removeAttachmentOp,
  startAgentsMdTaskOp,
  TaskEvent,
  TaskEventEntity,
  type TaskSummaryDTO,
} from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { callOperation } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { CONVENTION_COPY as C } from '../../copy/conventions.ts';

type Source =
  | { taskId: string; taskLabel: string; kind: 'failure'; eventId: number; label: string }
  | { taskId: string; taskLabel: string; kind: 'review'; commentId: string; label: string };
const selectionSchema = z.object({
  projectId: z.string(),
  sources: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        taskId: z.string(),
        taskLabel: z.string(),
        kind: z.literal('failure'),
        eventId: z.number(),
        label: z.string(),
      }),
      z.object({
        taskId: z.string(),
        taskLabel: z.string(),
        kind: z.literal('review'),
        commentId: z.string(),
        label: z.string(),
      }),
    ]),
  ),
});
const STORAGE_KEY = 'aw.convention.selection';
function readSelection(): z.infer<typeof selectionSchema> | undefined {
  const saved = sessionStorage.getItem(STORAGE_KEY);
  if (saved === null) return undefined;
  try {
    const parsed = selectionSchema.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
let selection = readSelection();
function saveSelection(value: z.infer<typeof selectionSchema> | undefined) {
  selection = value;
  if (value === undefined) sessionStorage.removeItem(STORAGE_KEY);
  else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function ConventionDialog({ task, reviewIds = [] }: { task: TaskSummaryDTO; reviewIds?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [rule, setRule] = useState('');
  const [scope, setScope] = useState('');
  const navigate = useNavigate();
  const events = useQuery({
    queryKey: ['convention-events', task.id],
    queryFn: () => callOperation(getTaskTimelineOp, { id: task.id }),
    enabled: open,
  });
  const preview = useMutation({
    mutationFn: () => {
      const sources = selection?.sources ?? [];
      return callOperation(previewConventionEvidenceOp, {
        id: task.project.id,
        failures: sources.flatMap((s) => (s.kind === 'failure' ? [{ taskId: s.taskId, eventId: s.eventId }] : [])),
        reviews: sources.flatMap((s) => (s.kind === 'review' ? [{ taskId: s.taskId, commentId: s.commentId }] : [])),
      });
    },
  });
  const start = useMutation({
    mutationFn: (attachmentId: string) =>
      callOperation(startAgentsMdTaskOp, {
        id: task.project.id,
        includeRules: false,
        evidenceAttachmentId: attachmentId,
        guidance: C.requirement(rule.trim(), scope.trim()),
      }),
    onSuccess: (created) => {
      saveSelection(undefined);
      setOpen(false);
      void navigate({ to: ROUTES.task, params: { taskId: created.id }, search: {} });
    },
  });
  const foreign = selection !== undefined && selection.projectId !== task.project.id;
  const sources = selection?.sources ?? [];
  const cleanup = useMutation({ mutationFn: (id: string) => callOperation(removeAttachmentOp, { id }) });
  const discardPreview = async () => {
    if (preview.data !== undefined) await cleanup.mutateAsync(preview.data.attachmentId);
    preview.reset();
  };
  const update = async (source: Source, checked: boolean) => {
    if (foreign) return;
    const key = (s: Source) => (s.kind === 'failure' ? `${s.taskId}:f:${s.eventId}` : `${s.taskId}:r:${s.commentId}`);
    const rest = sources.filter((s) => key(s) !== key(source));
    await discardPreview();
    saveSelection({ projectId: task.project.id, sources: checked ? [...rest, source] : rest });
    setVersion(version + 1);
  };
  const has = (s: Source) =>
    sources.some(
      (x) =>
        x.taskId === s.taskId &&
        x.kind === s.kind &&
        (x.kind === 'failure' && s.kind === 'failure'
          ? x.eventId === s.eventId
          : x.kind === 'review' && s.kind === 'review' && x.commentId === s.commentId),
    );
  const taskLabel = `${task.key} · ${task.title}`;
  const failureName = (type: string) =>
    Object.entries(C.failureNames).find(([key]) => key === type)?.[1] ?? C.failureNames.attempt_failed;
  const failureEvents =
    events.data?.items.filter(
      (e) =>
        (e.entity === TaskEventEntity.Task && e.type === TaskEvent.Fail) ||
        (e.entity === TaskEventEntity.Node &&
          [NodeEvent.ChecksFailed, NodeEvent.CheckUnrunnable, NodeEvent.AttemptFailed, NodeEvent.Reject].some(
            (t) => t === e.type,
          )) ||
        (e.entity === TaskEventEntity.Attempt && e.toStatus === AttemptStatus.Failed),
    ) ?? [];
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {C.open}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else if (!preview.isPending && !cleanup.isPending && !start.isPending)
            void (async () => {
              await discardPreview();
              setOpen(false);
            })();
        }}
        title={C.title}
      >
        <p className="hint">{C.instruction}</p>
        {foreign ? (
          <p>{C.differentProject}</p>
        ) : (
          <>
            <p>{C.choose}</p>
            {events.isError && <ErrorState error={events.error} />}
            {events.data !== undefined && failureEvents.length === 0 && <p className="hint">{C.noFailures}</p>}
            {failureEvents.map((e) => {
              const source: Source = {
                kind: 'failure',
                taskId: task.id,
                taskLabel,
                eventId: e.id,
                label: `${failureName(e.type)} · #${e.id} · ${new Date(e.createdAt).toLocaleString()}`,
              };
              return (
                <label className="check" key={e.id}>
                  <input
                    type="checkbox"
                    checked={has(source)}
                    disabled={preview.isPending || cleanup.isPending}
                    onChange={(ev) => void update(source, ev.target.checked)}
                  />
                  <span>{source.label}</span>
                </label>
              );
            })}
            {reviewIds.map((id) => {
              const source: Source = {
                kind: 'review',
                taskId: task.id,
                taskLabel,
                commentId: id,
                label: `审查意见 ${id}`,
              };
              return (
                <label className="check" key={id}>
                  <input
                    type="checkbox"
                    checked={has(source)}
                    disabled={preview.isPending || cleanup.isPending}
                    onChange={(ev) => void update(source, ev.target.checked)}
                  />
                  <span>{source.label}</span>
                </label>
              );
            })}
            <h3>{C.selected}</h3>
            {sources.length === 0 && <p className="hint">{C.empty}</p>}
            {sources.map((s) => (
              <div className="row" key={`${s.taskId}:${s.kind}:${s.kind === 'failure' ? s.eventId : s.commentId}`}>
                <Link to={ROUTES.task} params={{ taskId: s.taskId }} search={{}}>
                  {s.taskLabel} · {s.label}
                </Link>
                <Button
                  size="sm"
                  disabled={preview.isPending || cleanup.isPending}
                  onClick={() => void update(s, false)}
                >
                  {C.remove}
                </Button>
              </div>
            ))}
            <p className="hint">{C.caution}</p>
            <div className="field">
              <label className="label" htmlFor="convention-rule">
                {C.proposal}
              </label>
              <textarea
                id="convention-rule"
                maxLength={1000}
                className="textarea"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                placeholder={C.proposalPlaceholder}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="convention-scope">
                {C.applicability}
              </label>
              <input
                id="convention-scope"
                maxLength={500}
                className="input"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder={C.applicabilityPlaceholder}
              />
            </div>
            <Button
              disabled={sources.length === 0 || cleanup.isPending}
              pending={preview.isPending}
              onClick={() =>
                void (async () => {
                  await discardPreview();
                  preview.mutate();
                })()
              }
            >
              {C.preview}
            </Button>
            {preview.isError && <ErrorState error={preview.error} />}
            {preview.data !== undefined && (
              <>
                <h3>{C.suggestions}</h3>
                {preview.data.suggestions.map((suggestion) => (
                  <div key={`${suggestion.taskId}:${suggestion.eventId ?? suggestion.commentId}`}>
                    <p>
                      {suggestion.text} · {suggestion.applicability}
                    </p>
                    {suggestion.nodeId !== null && (
                      <Link
                        to={ROUTES.node}
                        params={{ taskId: suggestion.taskId, nodeId: suggestion.nodeId }}
                        search={{}}
                      >
                        {C.viewStep}
                      </Link>
                    )}
                    {suggestion.sourceUrl !== null && (
                      <ExternalLink href={suggestion.sourceUrl}>{C.viewComment}</ExternalLink>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setRule(suggestion.text);
                        setScope(suggestion.applicability);
                      }}
                    >
                      {C.useSuggestion}
                    </Button>
                  </div>
                ))}
                <h3>{C.draft}</h3>
                <p>
                  {rule} · {scope}
                </p>
                <h3>{C.evidence}</h3>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.data.text}</pre>
                <Link to={ROUTES.project} params={{ projectId: task.project.id }} hash="project-check">
                  {C.check}
                </Link>
                {' · '}
                <Link to={ROUTES.project} params={{ projectId: task.project.id }} hash="project-preview">
                  {C.previewSettings}
                </Link>
                <div>
                  <Button
                    variant="primary"
                    disabled={!rule.trim() || !scope.trim()}
                    pending={start.isPending}
                    onClick={() => start.mutate(preview.data.attachmentId)}
                  >
                    {C.start}
                  </Button>
                </div>
                {start.isError && <ErrorState error={start.error} />}
              </>
            )}
          </>
        )}
        {cleanup.isError && <ErrorState error={cleanup.error} />}
        <div className="row">
          <Button
            disabled={preview.isPending || cleanup.isPending}
            onClick={() =>
              void (async () => {
                await discardPreview();
                setOpen(false);
              })()
            }
          >
            {C.close}
          </Button>
          <Button
            disabled={preview.isPending || cleanup.isPending || start.isPending}
            onClick={() =>
              void (async () => {
                await discardPreview();
                saveSelection(undefined);
                setOpen(false);
              })()
            }
          >
            {C.oneOff}
          </Button>
          <Button
            disabled={preview.isPending || cleanup.isPending || start.isPending}
            onClick={() =>
              void (async () => {
                await discardPreview();
                saveSelection(undefined);
                setOpen(false);
              })()
            }
          >
            {C.cancel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
