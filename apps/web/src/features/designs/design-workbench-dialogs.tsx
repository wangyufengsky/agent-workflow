import { DESIGN_INSTRUCTION_MAX_CHARS, type DesignDTO, ErrorCode } from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import type { ReadingTarget } from './design-reading.ts';
import {
  useDeleteDesign,
  useExportDesign,
  useRestoreDesignSection,
  useReviseDesignSection,
} from './designs.queries.ts';

type TargetDialogProps = {
  design: DesignDTO;
  target: Exclude<ReadingTarget, { kind: 'overview' }>;
  title: string;
  close: () => void;
};

export function ReviseDesignDialog({
  design,
  target,
  title,
  model,
  initialInstruction,
  close,
}: TargetDialogProps & { model: string | null; initialInstruction: string }) {
  const mutation = useReviseDesignSection();
  const [instruction, setInstruction] = useState(initialInstruction);
  const submit = () => {
    const file = target.kind === 'file' ? design.files.find(({ id }) => id === target.fileId) : undefined;
    const symbol = target.kind === 'file' ? file?.symbols.find(({ id }) => id === target.symbolId) : undefined;
    mutation.mutate(
      {
        id: design.id,
        sectionId: target.sectionId,
        instruction: instruction.trim(),
        model,
        ...(file === undefined ? {} : { focusPath: file.relPath }),
        ...(symbol === undefined ? {} : { focusSymbol: symbol.qualifiedName }),
        ...(target.kind !== 'diagram' ? {} : { focusDiagramId: target.diagramId }),
      },
      { onSuccess: close },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={C.revise}
      description={C.reviseDescription(title)}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button variant="primary" pending={mutation.isPending} disabled={instruction.trim() === ''} onClick={submit}>
            {C.reviseSubmit}
          </Button>
        </>
      }
    >
      <label className="col">
        {C.reviseInstruction}
        <textarea
          className="input"
          rows={4}
          value={instruction}
          maxLength={DESIGN_INSTRUCTION_MAX_CHARS}
          onChange={(event) => setInstruction(event.currentTarget.value)}
        />
      </label>
      {mutation.isError && <ErrorState error={mutation.error} />}
    </Dialog>
  );
}

export function RestoreDesignDialog({ design, target, title, close }: TargetDialogProps) {
  const mutation = useRestoreDesignSection();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={C.restore}
      description={C.restoreDescription(title)}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button
            variant="primary"
            pending={mutation.isPending}
            onClick={() => mutation.mutate({ id: design.id, sectionId: target.sectionId }, { onSuccess: close })}
          >
            {C.restore}
          </Button>
        </>
      }
    >
      {mutation.isError && <ErrorState error={mutation.error} />}
    </Dialog>
  );
}

function suggestedTarget(design: DesignDTO, repoPath: string | null): string {
  if (design.lastExportedPath !== null) return design.lastExportedPath;
  if (repoPath === null) return '';
  const sep = repoPath.includes('\\') ? '\\' : '/';
  return [repoPath.replace(/[\\/]$/u, ''), 'docs', 'project-design-site'].join(sep);
}

export function ExportDesignDialog({
  design,
  repoPath,
  close,
}: {
  design: DesignDTO;
  repoPath: string | null;
  close: () => void;
}) {
  const mutation = useExportDesign();
  const [targetDir, setTargetDir] = useState(() => suggestedTarget(design, repoPath));
  const confirm = mutation.error instanceof ApiError && mutation.error.code === ErrorCode.DesignExportDirNotEmpty;
  const update = (value: string) => {
    mutation.reset();
    setTargetDir(value);
  };
  const choose = async () => {
    const dir = await window.aw?.selectDirectory(targetDir === '' ? undefined : targetDir);
    if (dir !== undefined && dir !== null) update(dir);
  };
  const submit = () =>
    mutation.mutate(
      { id: design.id, targetDir: targetDir.trim(), overwrite: confirm },
      {
        onSuccess: (exported) => {
          if (exported.lastExportedPath !== null) toast(C.exportDone(exported.lastExportedPath));
          close();
        },
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      title={C.export}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button
            variant={confirm ? 'danger' : 'primary'}
            pending={mutation.isPending}
            disabled={targetDir.trim() === ''}
            onClick={submit}
          >
            {confirm ? C.exportConfirm : C.exportSubmit}
          </Button>
        </>
      }
    >
      <div className="row">
        <label className="col grow">
          {C.exportDir}
          <input
            className="input"
            value={targetDir}
            disabled={mutation.isPending}
            onChange={(event) => update(event.currentTarget.value)}
          />
        </label>
        {window.aw !== undefined && (
          <Button disabled={mutation.isPending} onClick={() => void choose()}>
            {C.exportChoose}
          </Button>
        )}
      </div>
      {confirm ? (
        <p className="banner warn" role="alert">
          {C.exportWillReplace}
        </p>
      ) : mutation.isError ? (
        <ErrorState error={mutation.error} />
      ) : null}
    </Dialog>
  );
}

export function DeleteDesignDialog({ design, close }: { design: DesignDTO; close: () => void }) {
  const navigate = useNavigate();
  const mutation = useDeleteDesign(() => navigate({ to: ROUTES.designs }));
  return (
    <Dialog
      open
      title={C.remove}
      description={C.removeDescription(design.title)}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      footer={
        <>
          <Button onClick={close} disabled={mutation.isPending}>
            {COMMON_COPY.cancel}
          </Button>
          <Button variant="danger" pending={mutation.isPending} onClick={() => mutation.mutate(design.id)}>
            {C.remove}
          </Button>
        </>
      }
    >
      {mutation.isError && <ErrorState error={mutation.error} />}
    </Dialog>
  );
}
