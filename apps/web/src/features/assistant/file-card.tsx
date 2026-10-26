import { AttachmentFormat, type OfficeLossItem, type XlsxMeta } from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { saveBytes } from '../../app/save-file.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { toast } from '../../components/toast.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { formatBytes } from '../../copy/common.ts';
import { SheetView, WordBody } from '../attachments/attachment-preview.tsx';
import { assistantFilePreviewQuery, assistantFilesQuery, fetchAssistantFile } from './assistant.queries.ts';
import cards from './cards.module.css';

/** Word and Excel files have a preview (39 §8.2); the name decides, the backend reads the content. */
const officeKind = (path: string) =>
  /\.docx$/i.test(path) ? AttachmentFormat.Docx : /\.xlsx$/i.test(path) ? AttachmentFormat.Xlsx : undefined;

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/**
 * A file the assistant wrote (15 §2, 39 §8.2): saved where the user chooses, opened with the system's app (desktop),
 * shown in the file manager (desktop); a Word or Excel file also previews what is in it.
 */
export function FileCard({
  conversationId,
  path,
  lost,
}: {
  conversationId: string;
  path: string;
  /** What it lacks of the file it was written from (39 §7.2). */
  lost: readonly OfficeLossItem[];
}) {
  const file = useQuery(assistantFilesQuery(conversationId)).data?.find((f) => f.path === path);
  const [previewing, setPreviewing] = useState(false);
  const kind = officeKind(path);
  const bridge = window.aw;
  const save = useMutation({
    mutationFn: async () => saveBytes(fileName(path), await fetchAssistantFile(conversationId, path)),
    onSuccess: (saved) => {
      if (saved !== null && 'path' in saved) toast(C.file.saved(saved.path));
    },
  });
  const open = useMutation({
    mutationFn: (absolutePath: string) => (bridge as NonNullable<typeof bridge>).openPath(absolutePath),
  });
  return (
    <section className={`${cards.card} ${cards.linkCard}`} aria-label={C.attachment}>
      <div className={cards.cardHead}>
        <span className={cards.tile} aria-hidden="true">
          <Icon name={kind === AttachmentFormat.Xlsx ? 'table' : 'file'} size="sm" />
        </span>
        <span className={cards.cardHeading}>
          <span className={cards.eyebrow}>
            {[
              C.attachment,
              ...(kind === undefined ? [] : [C.file.kind[kind]]),
              ...(file === undefined ? [] : [formatBytes(file.size)]),
            ].join(' · ')}
          </span>
          <span className={`${cards.cardTitle} ellipsis`}>{path}</span>
        </span>
      </div>
      {lost.length > 0 && <p className="hint">{C.file.lost(lost)}</p>}
      <div className="row wrap">
        {kind !== undefined && (
          <Button size="sm" onClick={() => setPreviewing(true)}>
            {C.file.preview}
          </Button>
        )}
        <Button size="sm" pending={save.isPending} onClick={() => save.mutate()}>
          {C.file.save}
        </Button>
        {bridge !== undefined && file !== undefined && (
          <>
            <Button size="sm" pending={open.isPending} onClick={() => open.mutate(file.absolutePath)}>
              {C.file.open}
            </Button>
            <Button size="sm" onClick={() => void bridge.revealInFinder(file.absolutePath)}>
              {C.reveal}
            </Button>
          </>
        )}
      </div>
      {save.isError && <ErrorState error={save.error} />}
      {open.isError && <ErrorState error={open.error} />}
      {previewing && <FilePreview conversationId={conversationId} path={path} onClose={() => setPreviewing(false)} />}
    </section>
  );
}

/** What is in a Word or Excel file the assistant wrote, read the way an attachment is (39 §8.2). */
function FilePreview({ conversationId, path, onClose }: { conversationId: string; path: string; onClose: () => void }) {
  const first = useQuery(assistantFilePreviewQuery(conversationId, path, undefined));
  const data = first.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={fileName(path)}
      {...(data === undefined ? {} : { description: ATTACHMENTS_COPY.summary(data.meta) })}
      footer={<Button onClick={onClose}>{ATTACHMENTS_COPY.close}</Button>}
    >
      {first.error !== null && <ErrorState error={first.error} />}
      {data === undefined ? (
        first.error === null && <p className="hint">{ATTACHMENTS_COPY.loading}</p>
      ) : (
        <>
          <p className="hint">{ATTACHMENTS_COPY.officeNote}</p>
          {data.format === AttachmentFormat.Docx ? (
            <WordBody markdown={data.markdown} />
          ) : (
            <WorkbookTabs conversationId={conversationId} path={path} meta={data.meta} />
          )}
        </>
      )}
    </Dialog>
  );
}

function WorkbookTabs({ conversationId, path, meta }: { conversationId: string; path: string; meta: XlsxMeta }) {
  return (
    <Tabs
      items={meta.sheets.map((sheet) => ({
        value: sheet.name,
        label: sheet.hidden ? ATTACHMENTS_COPY.hiddenSheet(sheet.name) : sheet.name,
        content: <FileSheet conversationId={conversationId} path={path} sheet={sheet.name} />,
      }))}
    />
  );
}

function FileSheet({ conversationId, path, sheet }: { conversationId: string; path: string; sheet: string }) {
  const query = useQuery(assistantFilePreviewQuery(conversationId, path, sheet));
  if (query.error !== null) return <ErrorState error={query.error} />;
  if (query.data === undefined) return <p className="hint">{ATTACHMENTS_COPY.loading}</p>;
  // Asked for a sheet, the file is a workbook.
  return query.data.format === AttachmentFormat.Xlsx ? <SheetView data={query.data.sheet} /> : null;
}
