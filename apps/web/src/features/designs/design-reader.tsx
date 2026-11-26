import { type DesignDTO, DesignReviewState, type DesignSectionDTO } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { toast } from '../../components/toast.tsx';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_DIAGRAM_LABEL, DESIGN_REVIEW_LABEL } from '../../copy/design-workbench.ts';
import type { ContentContext } from './design-content.tsx';
import { DesignDiagram } from './design-diagram.tsx';
import { FileDetails } from './design-file-detail.tsx';
import { revealDesignSource } from './design-host.ts';
import {
  basename,
  fileSubmodule,
  fileTarget,
  graphNodeTarget,
  type ReadingTarget,
  submodulesOf,
} from './design-reading.ts';
import { SectionDetails, SubmoduleDetails } from './design-section-detail.tsx';
import styles from './design-workbench.module.css';

type ReaderProps = {
  design: DesignDTO;
  section: DesignSectionDTO;
  target: Exclude<ReadingTarget, { kind: 'overview' }>;
  repoPath: string | null;
  busy: boolean;
  canGenerate: boolean;
  onNavigate: (target: ReadingTarget) => void;
  onRevise: () => void;
  onRestore: () => void;
  onRetry: () => void;
  highlighted: boolean;
  failed: boolean;
};

function sourcePath(path: string, line?: number): string {
  return line === undefined ? path : `${path}:${line}`;
}

function copyPath(value: string): void {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(C.pathCopied);
    } catch {
      toast(C.copyFailure);
    }
  }
  void copy();
}

export function DesignReader({
  design,
  section,
  target,
  repoPath,
  busy,
  canGenerate,
  onNavigate,
  onRevise,
  onRestore,
  onRetry,
  highlighted,
  failed,
}: ReaderProps) {
  const file = target.kind === 'file' ? design.files.find(({ id }) => id === target.fileId) : undefined;
  const graph = target.kind === 'diagram' ? design.diagrams.find(({ id }) => id === target.diagramId) : undefined;
  const submodule =
    target.kind === 'submodule'
      ? submodulesOf(section).find(({ id }) => id === target.submoduleId)
      : file === undefined
        ? undefined
        : fileSubmodule(file, section);
  const symbol = target.kind === 'file' ? file?.symbols.find(({ id }) => id === target.symbolId) : undefined;
  const title = file !== undefined ? basename(file.relPath) : (graph?.title ?? submodule?.title ?? section.title);
  const isChapter = target.kind === 'section';
  const lineRange = target.kind === 'file' ? target.lines : undefined;
  const canEdit = design.projectId !== null && !busy;
  const context: ContentContext = {
    source: (path, line, end) => {
      const known = design.files.find(({ relPath }) => relPath === path);
      return (
        <span className={styles.source}>
          {known === undefined ? (
            <code>{sourcePath(path, line)}</code>
          ) : (
            <button
              type="button"
              className={`${styles.textButton} mono`}
              onClick={() =>
                onNavigate(
                  fileTarget(
                    known,
                    section.id,
                    known.symbols.find(
                      ({ lineStart, lineEnd }) => line !== undefined && lineStart <= line && lineEnd >= line,
                    )?.id,
                    line === undefined ? undefined : { start: line, end: end ?? line },
                  ),
                )
              }
            >
              {sourcePath(path, line)}
            </button>
          )}
          {repoPath !== null && window.aw !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon="external"
              aria-label={C.sourcePath}
              title={C.sourcePath}
              onClick={() => revealDesignSource(repoPath, path)}
            />
          )}
          <Button
            size="sm"
            icon="copy"
            variant="ghost"
            aria-label={C.clipboard}
            title={C.clipboard}
            onClick={() => copyPath(sourcePath(path, line))}
          />
        </span>
      );
    },
    figure: (id) => {
      const diagram = design.diagrams.find((item) => item.id === id);
      if (diagram === undefined) return null;
      return (
        <section className={styles.proseBlock}>
          {graph?.id !== diagram.id && (
            <h2>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => onNavigate({ kind: 'diagram', sectionId: diagram.sectionId, diagramId: id })}
              >
                {diagram.title}
              </button>
            </h2>
          )}
          <DesignDiagram
            key={diagram.id}
            diagram={diagram}
            transaction={section.blocks
              ?.filter((block) => block.type === 'transaction')
              .find((block) => block.diagramId === id)}
            targetOf={(node) => graphNodeTarget(design, diagram.sectionId, node)}
            onNavigate={onNavigate}
            source={context.source}
          />
        </section>
      );
    },
  };
  return (
    <article className={styles.article} data-highlight={highlighted || undefined}>
      <nav className={styles.breadcrumb} aria-label={C.breadcrumb}>
        <button type="button" className={styles.textButton} onClick={() => onNavigate({ kind: 'overview' })}>
          {C.overview}
        </button>
        <span aria-hidden="true">/</span>
        {isChapter ? (
          <span aria-current="page">{section.title}</span>
        ) : (
          <>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => onNavigate({ kind: 'section', sectionId: section.id })}
            >
              {section.title}
            </button>
            <span aria-hidden="true">/</span>
            {file !== undefined && submodule !== undefined && (
              <>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => onNavigate({ kind: 'submodule', sectionId: section.id, submoduleId: submodule.id })}
                >
                  {submodule.title}
                </button>
                <span aria-hidden="true">/</span>
              </>
            )}
            <span aria-current="page">{title}</span>
          </>
        )}
      </nav>
      <header className={styles.readerHeading} data-file={file !== undefined || undefined}>
        <div>
          <span className={styles.readerKind}>
            {file !== undefined
              ? C.file
              : graph !== undefined
                ? DESIGN_DIAGRAM_LABEL[graph.kind]
                : submodule !== undefined
                  ? C.submodule
                  : C.section}
          </span>
          <h2 className={file === undefined ? undefined : 'mono'}>{title}</h2>
        </div>
        <div className="row wrap">
          {section.reviewState !== DesignReviewState.None && (
            <span className={styles.sourceTag}>{DESIGN_REVIEW_LABEL[section.reviewState]}</span>
          )}
          {section.blocks !== null && design.projectId !== null && (
            <>
              <Button size="sm" icon="edit" disabled={!canEdit || !canGenerate} onClick={onRevise}>
                {C.revise}
              </Button>
              {section.hasPrevious && (
                <Button size="sm" variant="ghost" icon="undo" disabled={!canEdit} onClick={onRestore}>
                  {C.restore}
                </Button>
              )}
            </>
          )}
        </div>
      </header>
      {section.blocks === null ? (
        <div className={styles.emptyReader}>
          <strong>{failed ? C.failed : C.waiting}</strong>
          <p className="hint">{C.emptySectionDetail}</p>
          {canEdit && canGenerate && (
            <Button size="sm" icon="play" onClick={onRetry}>
              {failed ? C.reattempt : C.generateOne}
            </Button>
          )}
        </div>
      ) : file !== undefined ? (
        <FileDetails
          design={design}
          file={file}
          activeSymbol={symbol?.id}
          context={context}
          lineRange={lineRange}
          sectionId={section.id}
          onNavigate={onNavigate}
        />
      ) : graph !== undefined ? (
        context.figure(graph.id)
      ) : target.kind === 'submodule' && submodule !== undefined ? (
        <SubmoduleDetails
          design={design}
          module={submodule}
          section={section}
          context={context}
          onNavigate={onNavigate}
          files={design.files.filter(
            ({ sectionId, relPath }) => sectionId === section.id && submodule.files.includes(relPath),
          )}
        />
      ) : (
        <SectionDetails design={design} section={section} context={context} onNavigate={onNavigate} />
      )}
      <footer className={styles.reportVersion}>
        {design.commitSha === null ? C.noSource : C.reportVersion(design.commitSha.slice(0, 8))}
      </footer>
    </article>
  );
}
