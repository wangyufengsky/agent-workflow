import {
  type DeckDTO,
  DeckExportFormat,
  DeckStatus,
  isAttemptActive,
  StatusTone,
  THEME_IDS,
  themeIdSchema,
  UiMode,
} from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { toast } from '../../components/toast.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { canExportPdf, exportPdf, exportPptx, type Saved } from './export/save.ts';
import styles from './ppt.module.css';
import { deckQuery, useDeleteDeck, useUpdateDeck } from './ppt.queries.ts';

/** 大纲 → 制作 → 完成, by how far the PPT is (23 §2.4). */
function stepOf(deck: DeckDTO): number {
  if (!deck.outlineConfirmed) return 0;
  return deck.status === DeckStatus.Ready ? 2 : 1;
}

function Title({ deck }: { deck: DeckDTO }) {
  const update = useUpdateDeck();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <h1 className={`title ${styles.deckName}`}>
        <span className="ellipsis">{deck.title}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={C.rename}
          title={C.rename}
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" size="sm" />
        </button>
      </h1>
    );
  }
  const save = (title: string) => {
    setEditing(false);
    if (title.trim() !== '' && title.trim() !== deck.title) update.mutate({ id: deck.id, title: title.trim() });
  };
  return (
    <input
      className="input"
      aria-label={C.rename}
      defaultValue={deck.title}
      // biome-ignore lint/a11y/noAutofocus: the user just asked to rename
      autoFocus
      onBlur={(e) => save(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

/** Title, steps, theme, show, export and delete of one PPT (23 §2.4). */
export function DeckHeader({ deck, details }: { deck: DeckDTO; details: boolean }) {
  const navigate = useNavigate();
  const mode = useSettings()['ui.mode'];
  const update = useUpdateDeck();
  const remove = useDeleteDeck();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const exporting = useMutation({
    // The PPT as stored now: the page may still show a cached version, e.g. one the assistant has since finished.
    mutationFn: async (format: DeckExportFormat) => {
      const latest = await queryClient.fetchQuery({ ...deckQuery(deck.id), staleTime: 0 });
      return format === DeckExportFormat.Pdf ? exportPdf(latest) : exportPptx(latest);
    },
    onSuccess: (saved: Saved) => {
      if (saved !== null && !('failed' in saved)) toast(C.exported);
    },
  });
  // The assistant's `export_deck` runs here, as a click on the export button would (28 §4).
  const pendingExport = useUiStore((s) => s.pendingExport);
  const setPendingExport = useUiStore((s) => s.setPendingExport);
  const { mutate: exportAs } = exporting;
  useEffect(() => {
    if (pendingExport === null || pendingExport.deckId !== deck.id) return;
    setPendingExport(null);
    if (pendingExport.format === DeckExportFormat.Pdf && !canExportPdf()) {
      toast(C.exportPdfDesktopOnly, StatusTone.Danger);
    } else {
      exportAs(pendingExport.format);
    }
  }, [pendingExport, deck.id, setPendingExport, exportAs]);
  const busy = deck.runs.some((r) => isAttemptActive(r.attempt.status));
  const ready = deck.status === DeckStatus.Ready;
  const step = stepOf(deck);

  const play = () => {
    // Full screen needs the click's user activation, so it is asked for before navigating. Refused (no activation,
    // a browser policy), the show runs in the window instead.
    void document.documentElement.requestFullscreen().catch(() => undefined);
    void navigate({ to: ROUTES.pptPlay, params: { deckId: deck.id } });
  };

  return (
    <div className="col">
      <div className="page-head">
        <div className="grow col">
          <Link to={ROUTES.ppt} className="hint">
            ← {C.title}
          </Link>
          <Title deck={deck} />
          <p className="hint">{[deck.project?.name, C.pages(deck.slides.length)].filter(Boolean).join(' · ')}</p>
        </div>
        <ol className={styles.stepper} aria-label={C.steps.join(' → ')}>
          {C.steps.map((label, i) => (
            <li key={label} className={i < step ? styles.stepDone : i === step ? styles.stepNow : undefined}>
              {label}
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.toolbar}>
        <label className="row nowrap">
          <span className="hint">{C.theme}</span>
          <select
            className="select"
            aria-label={C.theme}
            value={deck.theme}
            onChange={(e) => update.mutate({ id: deck.id, theme: themeIdSchema.parse(e.target.value) })}
          >
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {THEME_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        <span className="grow" />
        {mode === UiMode.Simple && (
          <Link
            to={ROUTES.pptDeck}
            params={{ deckId: deck.id }}
            search={(prev) => ({ ...prev, details: !details || undefined })}
            className="btn ghost sm"
          >
            {details ? C.hideDetails : C.showDetails}
          </Link>
        )}
        <Button size="sm" icon="play" disabled={!deck.slides.some((s) => s.content !== null)} onClick={play}>
          {C.play}
        </Button>
        <Button
          size="sm"
          icon="download"
          disabled={!ready}
          title={ready ? C.exportPptxHint : C.exportNotReady}
          pending={exporting.isPending && exporting.variables === DeckExportFormat.Pptx}
          onClick={() => exporting.mutate(DeckExportFormat.Pptx)}
        >
          {C.exportPptx}
        </Button>
        {canExportPdf() && (
          <Button
            size="sm"
            icon="download"
            disabled={!ready}
            title={ready ? C.exportPdfHint : C.exportNotReady}
            pending={exporting.isPending && exporting.variables === DeckExportFormat.Pdf}
            onClick={() => exporting.mutate(DeckExportFormat.Pdf)}
          >
            {C.exportPdf}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          disabled={busy}
          title={busy ? C.deleteBusy : undefined}
          onClick={() => setConfirmDelete(true)}
        >
          {C.delete}
        </Button>
      </div>
      {exporting.isError && <ErrorState error={exporting.error} />}
      {exporting.data !== undefined && exporting.data !== null && 'failed' in exporting.data && (
        <ErrorState error={exporting.data.failed} />
      )}
      {update.isError && <ErrorState error={update.error} />}
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={C.deleteTitle}
        description={C.deleteBody(deck.title)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{C.cancel}</Button>
            <Button
              variant="danger"
              pending={remove.isPending}
              onClick={() => remove.mutate(deck.id, { onSuccess: () => void navigate({ to: ROUTES.ppt }) })}
            >
              {C.delete}
            </Button>
          </>
        }
      >
        {remove.isError && <ErrorState error={remove.error} />}
      </Dialog>
    </div>
  );
}
