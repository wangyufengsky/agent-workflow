import {
  DESIGN_TITLE_MAX_CHARS,
  DeckMaterialKind,
  type DesignDTO,
  DesignStatus,
  designLayoutStyleSchema,
  StatusTone,
} from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { StatusBadge } from '../../components/status-badge.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { DESIGN_LAYOUT_LABEL, DESIGN_STATUS_LABEL } from '../../copy/designs.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { DesignPermissionPicker } from './design-permission-picker.tsx';
import styles from './design-workbench.module.css';
import { useUpdateDesign } from './designs.queries.ts';

function statusTone(status: DesignStatus): StatusTone {
  if (status === DesignStatus.Generating || status === DesignStatus.Reviewing || status === DesignStatus.Outlining) {
    return StatusTone.Run;
  }
  if (status === DesignStatus.Ready) return StatusTone.Ok;
  if (status === DesignStatus.Failed) return StatusTone.Danger;
  if (status === DesignStatus.Incomplete) return StatusTone.Warn;
  return StatusTone.Idle;
}

function DesignTitle({ design, disabled }: { design: DesignDTO; disabled: boolean }) {
  const update = useUpdateDesign();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <>
        <h1>{design.title}</h1>
        {design.projectId !== null && (
          <Button
            size="sm"
            variant="ghost"
            icon="edit"
            disabled={disabled}
            aria-label={C.rename}
            title={C.rename}
            onClick={() => setDraft(design.title)}
          />
        )}
      </>
    );
  }
  const submit = () => {
    if (draft.trim() === design.title) {
      setDraft(null);
      return;
    }
    update.mutate({ id: design.id, title: draft.trim() }, { onSuccess: () => setDraft(null) });
  };
  return (
    <form
      className={styles.rename}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="row">
        <input
          className="input"
          // biome-ignore lint/a11y/noAutofocus: The user explicitly opened inline editing.
          autoFocus
          aria-label={C.rename}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={DESIGN_TITLE_MAX_CHARS}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
            }
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          pending={update.isPending}
          aria-label={COMMON_COPY.save}
          icon="check"
          disabled={draft.trim() === '' || disabled}
        />
        <Button
          size="sm"
          icon="x"
          aria-label={COMMON_COPY.cancel}
          disabled={update.isPending}
          onClick={() => setDraft(null)}
        />
      </div>
      {update.isError && <ErrorState error={update.error} />}
    </form>
  );
}

export function DesignToolbar({
  design,
  changedFilesCount,
  busy,
  canGenerate,
  follow,
  panelOpen,
  onFollow,
  onPanel,
  onContinue,
  onReview,
  onStop,
  onExport,
  onDelete,
  continuePending,
  reviewPending,
  stopPending,
  runtimeLabel,
}: {
  design: DesignDTO;
  changedFilesCount: number | undefined;
  busy: boolean;
  canGenerate: boolean;
  follow: boolean;
  panelOpen: boolean;
  onFollow: (follow: boolean) => void;
  onPanel: () => void;
  onContinue: () => void;
  onReview: () => void;
  onStop: () => void;
  onExport: () => void;
  onDelete: () => void;
  continuePending: boolean;
  reviewPending: boolean;
  stopPending: boolean;
  runtimeLabel: string | undefined;
}) {
  const update = useUpdateDesign();
  const source = C.source(design.branch, design.commitSha) || C.noSource;
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.context}>
          <Link className={styles.textButton} to={ROUTES.designs}>
            {C.workspace}
          </Link>
          {design.project !== null && (
            <>
              <span aria-hidden="true">/</span>
              <Link className={styles.textButton} to={ROUTES.project} params={{ projectId: design.project.id }}>
                {design.project.name}
              </Link>
            </>
          )}
        </div>
        <div className={styles.headline}>
          <DesignTitle design={design} disabled={busy} />
          <StatusBadge
            tone={design.handoffPending ? StatusTone.Run : statusTone(design.status)}
            label={design.handoffPending ? C.handoffPending : DESIGN_STATUS_LABEL[design.status]}
          />
          {changedFilesCount !== undefined && (
            <StatusBadge tone={StatusTone.Warn} label={C.staleBadge(changedFilesCount)} />
          )}
        </div>
        <div className={styles.meta}>
          <span className="mono" title={design.sourceSnapshot.dirty ? C.dirty : undefined}>
            <Icon name="branch" size="sm" /> {source}
            {design.sourceSnapshot.dirty ? ' · *' : ''}
          </span>
          <span>{C.coverage(design.analyzedCount, design.analyzableCount)}</span>
          {!panelOpen && <span>{C.progress(design.doneSections, design.totalSections)}</span>}
        </div>
      </div>
      <div className={styles.actions}>
        <DesignPermissionPicker design={design} />
        <fieldset className={styles.segment} aria-label={C.mode}>
          <Button size="sm" variant="ghost" aria-pressed={follow} onClick={() => onFollow(true)}>
            {C.follow}
          </Button>
          <Button size="sm" variant="ghost" aria-pressed={!follow} onClick={() => onFollow(false)}>
            {C.free}
          </Button>
        </fieldset>
        {busy ? (
          <Button size="sm" variant="danger" icon="stop" pending={stopPending} onClick={onStop}>
            {C.stop}
          </Button>
        ) : design.doneSections < design.totalSections && design.projectId !== null ? (
          <Button
            size="sm"
            variant="primary"
            icon="play"
            pending={continuePending}
            disabled={!canGenerate}
            title={runtimeLabel}
            onClick={onContinue}
          >
            {C.continue}
          </Button>
        ) : design.projectId !== null ? (
          <Button
            size="sm"
            icon="check"
            pending={reviewPending}
            disabled={!canGenerate}
            title={runtimeLabel}
            onClick={onReview}
          >
            {C.review}
          </Button>
        ) : null}
        <Button
          size="sm"
          icon="download"
          disabled={busy || design.doneSections === 0}
          title={design.doneSections === 0 ? C.noExport : undefined}
          onClick={onExport}
        >
          {C.export}
        </Button>
        <Button size="sm" icon="terminal" variant="ghost" aria-pressed={panelOpen} onClick={onPanel}>
          {C.attempts}
        </Button>
        <details className={styles.more}>
          <summary className="btn ghost sm" aria-label={C.more} title={C.more}>
            <Icon name="sliders" />
          </summary>
          <div className={styles.preferences}>
            {design.doneSections > 0 && (
              <Link
                to={ROUTES.deckNew}
                search={{ kind: DeckMaterialKind.Design, refId: design.id, projectId: design.projectId ?? undefined }}
                className="btn sm"
              >
                <Icon name="slides" size="sm" />
                {PPT_COPY.makeLinkedDeck}
              </Link>
            )}
            <label className="col">
              <span>{C.layout}</span>
              <select
                className="select"
                disabled={update.isPending || design.projectId === null}
                value={design.layoutStyle}
                onChange={(event) =>
                  update.mutate({
                    id: design.id,
                    layoutStyle: designLayoutStyleSchema.parse(event.currentTarget.value),
                  })
                }
              >
                {Object.entries(DESIGN_LAYOUT_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {design.projectId !== null && (
              <label className="row">
                <input
                  type="checkbox"
                  checked={design.aiReviewEnabled}
                  disabled={busy || update.isPending}
                  onChange={(event) => update.mutate({ id: design.id, aiReviewEnabled: event.currentTarget.checked })}
                />
                <span>{C.reviewEnabled}</span>
              </label>
            )}
            <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={onDelete}>
              {C.remove}
            </Button>
            {update.isError && <ErrorState error={update.error} />}
          </div>
        </details>
      </div>
    </header>
  );
}
