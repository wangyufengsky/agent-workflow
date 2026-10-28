import {
  BatchDeliveryOutcome,
  type InitiativeDetailDTO,
  type InitiativeItemDTO,
  InitiativeItemStatus,
  InitiativeRunMode,
  InitiativeStatus,
  isBatchDeliverable,
  STATUS_TONE,
  StatusTone,
  UiMode,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { ERROR_COPY } from '../../copy/errors.ts';
import {
  INITIATIVES_COPY as C,
  INITIATIVE_ITEM_STATUS_LABEL,
  INITIATIVE_TEMPLATES_COPY,
} from '../../copy/initiatives.ts';
import { SentAttachments } from '../attachments/sent-attachments.tsx';
import { useSettings } from '../settings/settings.queries.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import { BreakdownStatus, hasOpenItems, RebreakdownButton, RefineButton, Understanding } from './breakdown-panel.tsx';
import { DraftEditor } from './draft-editor.tsx';
import { InitiativeProgress } from './initiative-card.tsx';
import styles from './initiatives.module.css';
import {
  initiativeQuery,
  useConfirmInitiative,
  useConfirmInitiativeItemMerged,
  useDeleteInitiative,
  useDeliverInitiativePhase,
  useDropInitiativeItem,
  useOpenInitiativePhase,
  useStartInitiativeItem,
} from './initiatives.queries.ts';

const route = getRouteApi(ROUTE_IDS.initiative);

const DROPPABLE: readonly InitiativeItemStatus[] = [
  InitiativeItemStatus.Ready,
  InitiativeItemStatus.Waiting,
  InitiativeItemStatus.PhaseClosed,
  InitiativeItemStatus.PrOpen,
];

/** A button that asks first: what it does is spelled out in a dialog (D16 for merges). */
function Confirmed({
  label,
  title,
  body,
  confirm,
  variant = 'secondary',
  pending,
  error,
  disabled,
  children,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  confirm: string;
  variant?: 'primary' | 'secondary' | 'danger';
  pending: boolean;
  error: unknown;
  disabled?: boolean;
  children?: ReactNode;
  onConfirm: (close: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={body}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{COMMON_COPY.cancel}</Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              pending={pending}
              onClick={() => onConfirm(() => setOpen(false))}
            >
              {confirm}
            </Button>
          </>
        }
      >
        {children}
        {error !== null && <ErrorState error={error} />}
      </Dialog>
    </>
  );
}

/**
 * What can be done with one work package from here; its task's own actions are on the task page. A draft waiting for
 * confirmation may have rewritten the package, so it starts only after the draft is confirmed (11).
 */
function ItemActions({ initiative, item }: { initiative: InitiativeDetailDTO; item: InitiativeItemDTO }) {
  const start = useStartInitiativeItem();
  const merged = useConfirmInitiativeItemMerged();
  const drop = useDropInitiativeItem();
  const [reason, setReason] = useState('');
  const ref = { id: initiative.id, key: item.key };
  return (
    <div className={styles.actions}>
      {item.status === InitiativeItemStatus.Ready && initiative.status !== InitiativeStatus.DraftReady && (
        <Button size="sm" variant="primary" pending={start.isPending} onClick={() => start.mutate(ref)}>
          {C.start}
        </Button>
      )}
      {item.status === InitiativeItemStatus.PrOpen && (
        <Confirmed
          label={C.merged}
          title={C.mergedTitle}
          body={C.mergedBody(initiative.baseBranch)}
          confirm={C.merged}
          variant="primary"
          pending={merged.isPending}
          error={merged.error}
          onConfirm={(close) => merged.mutate(ref, { onSuccess: close })}
        />
      )}
      {DROPPABLE.includes(item.status) && (
        <Confirmed
          label={C.drop}
          title={C.dropTitle(item.title)}
          body={C.dropBody}
          confirm={C.drop}
          variant="danger"
          pending={drop.isPending}
          error={drop.error}
          onConfirm={(close) => drop.mutate({ ...ref, reason: reason.trim() }, { onSuccess: close })}
        >
          <label className="col">
            <span className="hint">{C.dropReason}</span>
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </Confirmed>
      )}
      {start.isError && <ErrorState error={start.error} />}
    </div>
  );
}

function ItemRow({ initiative, item }: { initiative: InitiativeDetailDTO; item: InitiativeItemDTO }) {
  return (
    <tr data-testid="initiative-item">
      <td>
        <span className="section-title">{item.title}</span>
        <span className={styles.note}>
          <span className="mono">{item.key}</span> · {item.workflowName ?? item.workflow}
          {item.dependsOn.length > 0 && ` · ${C.dependsOn(item.dependsOn)}`}
        </span>
        {item.startError !== null && (
          <span className={styles.error}>
            {C.startError}
            {ERROR_COPY[item.startError.code]}
          </span>
        )}
        {item.dropReason !== null && <span className={styles.note}>{item.dropReason}</span>}
      </td>
      <td>
        <StatusBadge tone={STATUS_TONE.initiativeItem[item.status]} label={INITIATIVE_ITEM_STATUS_LABEL[item.status]} />
      </td>
      <td>
        {item.task === null ? (
          <span className="hint">{C.noTask}</span>
        ) : (
          <div className="col">
            <Link to={ROUTES.task} params={{ taskId: item.task.id }}>
              <span className="mono">{item.task.key}</span> · {item.task.title}
            </Link>
            <TaskBadge group={item.task.displayGroup} archived={item.task.archivedAt !== null} />
          </div>
        )}
      </td>
      <td>
        <ItemActions initiative={initiative} item={item} />
      </td>
    </tr>
  );
}

/** One phase: its work packages, opening it, and merging what of it waits for review. */
function Phase({ initiative, index }: { initiative: InitiativeDetailDTO; index: number }) {
  const phase = initiative.phases[index - 1];
  const open = useOpenInitiativePhase();
  const deliver = useDeliverInitiativePhase();
  // Refining what is left on the merged code first is the default (D136) when anything can still change.
  const refinable = hasOpenItems(initiative, index);
  const [refine, setRefine] = useState(refinable);
  if (phase === undefined) return null;
  const items = initiative.items.filter((item) => item.phase === index);
  const deliverable = items.filter(
    (item) => item.task !== null && isBatchDeliverable({ task: item.task, lastDelivery: item.lastDelivery }),
  ).length;
  const canOpen =
    !phase.opened && index === initiative.openedPhase + 1 && initiative.status === InitiativeStatus.PhaseDone;
  return (
    <section className={`card pad ${styles.phase}`} data-testid="initiative-phase">
      <div className={styles.phaseHead}>
        <h2 className="section-title grow">{C.phase(index, phase.title)}</h2>
        {!phase.opened && <span className="hint">{phase.autoOpen ? C.autoOpen : C.phaseClosed}</span>}
        {canOpen && (
          <Confirmed
            label={C.openPhase(index)}
            title={C.openPhaseTitle(index)}
            body={C.openPhaseBody}
            confirm={C.openPhase(index)}
            variant="primary"
            pending={open.isPending}
            error={open.error}
            onConfirm={(close) =>
              open.mutate({ id: initiative.id, phase: index, refine: refinable && refine }, { onSuccess: close })
            }
          >
            {refinable && (
              <label className="check">
                <input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} />
                <span>
                  {C.refineFirst}
                  <span className={styles.note}>{C.refineFirstHint}</span>
                </span>
              </label>
            )}
          </Confirmed>
        )}
        {deliverable > 0 && (
          <Confirmed
            label={C.deliverPhase(deliverable)}
            title={C.deliverTitle(deliverable, initiative.baseBranch)}
            body={C.deliverBody}
            confirm={C.deliverPhase(deliverable)}
            variant="primary"
            pending={deliver.isPending}
            error={deliver.error}
            onConfirm={(close) =>
              deliver.mutate(
                { id: initiative.id, phase: index },
                {
                  onSuccess: ({ outcomes }) => {
                    close();
                    const count = (o: BatchDeliveryOutcome) => outcomes.filter((x) => x.outcome === o).length;
                    const delivered = count(BatchDeliveryOutcome.Delivered);
                    toast(
                      C.outcome(delivered, count(BatchDeliveryOutcome.Conflict), count(BatchDeliveryOutcome.Failed)),
                      delivered === outcomes.length ? StatusTone.Ok : StatusTone.Danger,
                    );
                  },
                },
              )
            }
          />
        )}
      </div>
      {phase.goal !== '' && <p className="hint">{phase.goal}</p>}
      <table className={styles.table}>
        <tbody>
          {items.map((item) => (
            <ItemRow key={item.key} initiative={initiative} item={item} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** An initiative (34 §5): its phases and work packages, each work package's task, and the gates between phases. */
export function InitiativePage() {
  const { initiativeId } = route.useParams();
  const initiative = useQuery(initiativeQuery(initiativeId));
  const [editing, setEditing] = useState(false);
  const confirm = useConfirmInitiative();
  const remove = useDeleteInitiative();
  const navigate = useNavigate();
  const pro = useSettings()['ui.mode'] === UiMode.Pro;
  if (initiative.isPending) return <p className="page hint">{COMMON_COPY.loading}</p>;
  if (initiative.isError) {
    return (
      <div className="page narrow">
        <ErrorState error={initiative.error} onRetry={() => void initiative.refetch()} />
      </div>
    );
  }
  const i = initiative.data;
  const draft = i.status === InitiativeStatus.DraftReady;
  const busy = i.status === InitiativeStatus.BreakingDown;
  const editable = !busy && hasOpenItems(i);
  const run = i.latestRun;
  // After a refinement asked for by「进入第 k 阶段」, confirming opens that phase (34 §5.5).
  const confirmLabel =
    i.openedPhase === 0
      ? C.confirm
      : run?.mode === InitiativeRunMode.Refine && run.openPhase !== null
        ? C.confirmPhase(run.openPhase)
        : C.confirmRefined;
  const canRefine = !busy && !draft && i.openedPhase > 0 && i.status !== InitiativeStatus.Done && hasOpenItems(i);
  return (
    <div className="page" data-testid="initiative-page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">
            <span className="mono">{i.key}</span> · {i.title}
          </h1>
          <p className="lede">
            {C.meta(i.project.name, i.template?.name ?? null)} · {i.baseBranch} · {formatDateTime(i.createdAt)}
          </p>
        </div>
        {!editing && canRefine && <RefineButton initiative={i} />}
        {!editing && editable && <Button onClick={() => setEditing(true)}>{C.edit}</Button>}
        {/* 存为模板 (34 §15.6): custom templates are a pro-mode page. */}
        {pro && !busy && (
          <Link to={ROUTES.initiativeTemplateNew} search={{ initiative: i.id }} className="btn ghost">
            {INITIATIVE_TEMPLATES_COPY.saveAs}
          </Link>
        )}
        <Confirmed
          label={C.delete}
          title={C.deleteTitle}
          body={C.deleteBody}
          confirm={C.delete}
          variant="danger"
          disabled={busy}
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(i.id, { onSuccess: () => void navigate({ to: ROUTES.initiatives }) })}
        />
      </div>
      <section className="card pad col">
        <InitiativeProgress initiative={i} />
        <details>
          <summary className="hint">{C.requirement}</summary>
          <p className={styles.requirement}>{i.requirement}</p>
          {i.attachments.length > 0 && <SentAttachments attachments={i.attachments} />}
        </details>
      </section>
      <BreakdownStatus initiative={i} />
      <Understanding initiative={i} />
      {draft && !editing && (
        <div className="banner">
          <span className="grow">{i.openedPhase === 0 ? C.draftHint : C.draftRefinedHint}</span>
          {i.openedPhase === 0 && run !== null && <RebreakdownButton initiative={i} label={C.rebreakdown} />}
          <Button variant="primary" pending={confirm.isPending} onClick={() => confirm.mutate(i.id)}>
            {confirmLabel}
          </Button>
        </div>
      )}
      {confirm.isError && <ErrorState error={confirm.error} />}
      {editing ? (
        <DraftEditor initiative={i} onDone={() => setEditing(false)} />
      ) : (
        i.phases.map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: phases are positional, their number is what items refer to
          <Phase key={index} initiative={i} index={index + 1} />
        ))
      )}
    </div>
  );
}
