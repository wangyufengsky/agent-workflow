import { AttemptStatus, type DesignDTO, type DesignRunDTO, DesignRunKind, RuntimeStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { RUNTIME_STATUS_LABEL } from '../../copy/runtime.ts';
import { runtimeQuery } from '../runtime/runtime.queries.ts';
import { DEFAULT_NAV, DesignOutlineNav, OutlineResizer } from './design-outline-nav.tsx';
import { DesignOverview } from './design-overview.tsx';
import { DesignReader } from './design-reader.tsx';
import {
  basename,
  followedSection,
  progressSection,
  type ReadingTarget,
  submodulesOf,
  targetKey,
} from './design-reading.ts';
import { DesignRunPanel } from './design-run-panel.tsx';
import { DesignToolbar } from './design-toolbar.tsx';
import styles from './design-workbench.module.css';
import {
  DeleteDesignDialog,
  ExportDesignDialog,
  RestoreDesignDialog,
  ReviseDesignDialog,
} from './design-workbench-dialogs.tsx';
import { useGenerateDesign, useReviewDesign, useStopDesign } from './designs.queries.ts';

type Props = { design: DesignDTO; model: string | null; repoPath: string | null };
type EditableTarget = Exclude<ReadingTarget, { kind: 'overview' }>;
type Reading = { target: ReadingTarget; highlighted: boolean };
type OpenPanel = { runId: string | undefined; active: boolean; open: boolean };

function failedSections(runs: readonly DesignRunDTO[]): Set<string> {
  const pending = new Map<string, boolean>();
  for (const run of runs) {
    if (run.kind !== DesignRunKind.Generate && run.kind !== DesignRunKind.Revise) continue;
    const failure = run.attempt.status === AttemptStatus.Failed ? progressSection(run) : undefined;
    for (const id of run.targetSectionIds) {
      // 后续运行替代之前同一目标的状态。失败只归于当时处理的第一章。
      pending.set(id, id === failure);
    }
  }
  return new Set([...pending].flatMap(([id, failed]) => (failed ? [id] : [])));
}

export function DesignWorkbench({ design, model, repoPath }: Props) {
  const runtime = useQuery(runtimeQuery);
  const generate = useGenerateDesign();
  const review = useReviewDesign();
  const stop = useStopDesign();
  const active = design.runs.find(({ id }) => id === design.activeRunId);
  const busy = active !== undefined || design.handoffPending;
  const latest = design.runs.at(-1);
  const selected = design.sections.filter(({ selected }) => selected);
  const followed = followedSection(design.runs, selected);
  const submissions = design.runs.reduce(
    (count, run) =>
      count +
      (run.kind === DesignRunKind.Generate || run.kind === DesignRunKind.Revise ? run.doneSectionIds.length : 0),
    0,
  );
  const [initialSubmissions] = useState(() => (busy && submissions > 0 ? -1 : submissions));
  const [followFromCurrent, setFollowFromCurrent] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [panel, setPanel] = useState<OpenPanel>();
  const [navOpen, setNavOpen] = useState(true);
  const [navWidth, setNavWidth] = useState(DEFAULT_NAV);
  const [dialog, setDialog] = useState<
    | { kind: 'revise'; target: EditableTarget; instruction?: string | null }
    | { kind: 'restore'; target: EditableTarget }
    | { kind: 'export' }
    | { kind: 'delete' }
    | null
  >(null);
  const failures = failedSections(design.runs);
  const pending = generate.isPending || review.isPending || stop.isPending;
  const runtimeLabel =
    runtime.data?.status === undefined || runtime.data.status === RuntimeStatus.Ready
      ? undefined
      : RUNTIME_STATUS_LABEL[runtime.data.status];
  // 运行时面板只展示托管进程状态；执行服务以当前尝试引擎的就绪状态决定是否能启动。
  const canGenerate = design.projectId !== null && !busy && !pending;
  const automatic = followFromCurrent || submissions > initialSubmissions ? followed : undefined;
  const requested: ReadingTarget =
    reading?.target ?? (automatic === undefined ? { kind: 'overview' } : { kind: 'section', sectionId: automatic });
  const section = requested.kind === 'overview' ? undefined : selected.find(({ id }) => id === requested.sectionId);
  const currentTarget: ReadingTarget =
    requested.kind === 'overview' || section !== undefined ? requested : { kind: 'overview' };
  const candidateId = active?.id ?? latest?.id;
  const panelOpen =
    panel?.runId === candidateId && panel?.active === busy
      ? panel.open
      : busy || latest?.attempt.status === AttemptStatus.Failed;
  const keepReading = () => {
    if (reading === null) setReading({ target: currentTarget, highlighted: false });
  };
  const navigate = (target: ReadingTarget, highlighted = false) => setReading({ target, highlighted });
  const error = generate.error ?? review.error ?? stop.error;
  const closeDialog = () => setDialog(null);
  const continueGeneration = (sectionId?: string) =>
    generate.mutate({ id: design.id, ...(sectionId === undefined ? {} : { sectionId }), model });
  const retry = (run: DesignRunDTO) => {
    if (run.kind === DesignRunKind.Review) {
      review.mutate({ id: design.id, model });
    } else if (run.kind === DesignRunKind.Revise) {
      const sectionId = run.targetSectionIds[0];
      if (sectionId !== undefined)
        setDialog({ kind: 'revise', target: { kind: 'section', sectionId }, instruction: run.instruction });
    } else if (run.kind === DesignRunKind.Generate) {
      continueGeneration(progressSection(run));
    }
  };
  const dialogSection =
    dialog === null || !('target' in dialog)
      ? undefined
      : design.sections.find(({ id }) => id === dialog.target.sectionId);
  const dialogTitle = (() => {
    if (dialog === null || !('target' in dialog)) return '';
    const { target } = dialog;
    if (target.kind === 'diagram')
      return design.diagrams.find(({ id }) => id === target.diagramId)?.title ?? dialogSection?.title ?? '';
    if (target.kind === 'file')
      return basename(design.files.find(({ id }) => id === target.fileId)?.relPath ?? dialogSection?.title ?? '');
    if (target.kind === 'submodule' && dialogSection !== undefined)
      return submodulesOf(dialogSection).find(({ id }) => id === target.submoduleId)?.title ?? dialogSection.title;
    return dialogSection?.title ?? '';
  })();

  return (
    <div className={styles.workbench}>
      <DesignToolbar
        design={design}
        busy={busy}
        canGenerate={canGenerate}
        follow={reading === null}
        panelOpen={panelOpen}
        onFollow={(follow) => {
          if (follow) {
            setFollowFromCurrent(true);
            setReading(null);
          } else keepReading();
        }}
        onPanel={() => setPanel({ runId: candidateId, active: busy, open: !panelOpen })}
        onContinue={() => continueGeneration()}
        onReview={() => review.mutate({ id: design.id, model })}
        onStop={() => stop.mutate(design.id)}
        onExport={() => setDialog({ kind: 'export' })}
        onDelete={() => setDialog({ kind: 'delete' })}
        continuePending={generate.isPending}
        reviewPending={review.isPending}
        stopPending={stop.isPending}
        runtimeLabel={runtimeLabel}
      />
      {error !== null && <ErrorState error={error} />}
      {design.projectId === null && <p className={styles.readOnly}>{C.readOnly}</p>}
      <div
        className={styles.panes}
        data-nav={navOpen}
        data-process={panelOpen}
        style={{ '--design-nav-width': `${navWidth}px` } as CSSProperties}
      >
        {
          <DesignOutlineNav
            design={design}
            hidden={!navOpen}
            target={currentTarget}
            active={active}
            failedIds={failures}
            onCollapse={() => setNavOpen(false)}
            onNavigate={navigate}
          />
        }
        {navOpen ? (
          <OutlineResizer width={navWidth} onWidth={setNavWidth} />
        ) : (
          <div className={styles.collapsedNav}>
            <Button size="sm" icon="list" variant="ghost" aria-label={C.showNav} onClick={() => setNavOpen(true)} />
          </div>
        )}
        {
          <section
            className={styles.reader}
            aria-label={C.reader}
            data-follow={reading === null}
            key={targetKey(currentTarget)}
            // 跟随切章会换一个从顶部开始的滚动区，非零滚动才是当前章的阅读操作。
            onScroll={(event) => {
              if (event.currentTarget.scrollTop > 0) keepReading();
            }}
            onWheel={keepReading}
            onTouchMove={keepReading}
            onKeyDown={(event) => {
              if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) keepReading();
            }}
          >
            {section === undefined || currentTarget.kind === 'overview' ? (
              <DesignOverview
                design={design}
                active={active}
                highlighted={reading?.highlighted === true}
                onNavigate={navigate}
              />
            ) : (
              <DesignReader
                design={design}
                section={section}
                target={currentTarget}
                repoPath={repoPath}
                busy={busy || pending}
                canGenerate={canGenerate}
                onNavigate={navigate}
                highlighted={reading?.highlighted === true}
                failed={failures.has(section.id)}
                onRevise={() => setDialog({ kind: 'revise', target: currentTarget })}
                onRestore={() => setDialog({ kind: 'restore', target: currentTarget })}
                onRetry={() => continueGeneration(section.id)}
              />
            )}
          </section>
        }
        {panelOpen && (
          <DesignRunPanel
            design={design}
            active={active}
            latest={latest}
            canGenerate={canGenerate}
            onRetry={retry}
            onClose={() => setPanel({ runId: candidateId, active: busy, open: false })}
          />
        )}
      </div>
      {dialog?.kind === 'delete' && <DeleteDesignDialog design={design} close={closeDialog} />}
      {dialog?.kind === 'export' && <ExportDesignDialog design={design} repoPath={repoPath} close={closeDialog} />}
      {dialog?.kind === 'revise' && (
        <ReviseDesignDialog
          design={design}
          target={dialog.target}
          title={dialogTitle}
          model={model}
          initialInstruction={dialog.instruction ?? ''}
          close={closeDialog}
        />
      )}
      {dialog?.kind === 'restore' && (
        <RestoreDesignDialog design={design} target={dialog.target} title={dialogTitle} close={closeDialog} />
      )}
    </div>
  );
}
