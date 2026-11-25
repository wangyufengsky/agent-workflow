import {
  type DesignDTO,
  DesignLayoutStyle,
  DesignReviewState,
  type DesignSectionDTO,
  DesignSectionKind,
} from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { toast } from '../../components/toast.tsx';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_DIAGRAM_LABEL, DESIGN_REVIEW_LABEL } from '../../copy/design-workbench.ts';
import { ContentBlock, type ContentContext, markdownComponents } from './design-content.tsx';
import { DesignDiagram } from './design-diagram.tsx';
import { FileDetails } from './design-file-detail.tsx';
import { revealDesignSource } from './design-host.ts';
import { fileTarget, graphNodeTarget, type ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';

type ReaderProps = {
  design: DesignDTO;
  section: DesignSectionDTO;
  target: ReadingTarget;
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

function SectionDetails({
  design,
  section,
  context,
  onNavigate,
}: Pick<ReaderProps, 'design' | 'section' | 'onNavigate'> & {
  context: ContentContext;
}) {
  const files = design.files.filter(
    ({ sectionId, responsibility }) => sectionId === section.id && responsibility !== null,
  );
  const graphs = design.diagrams.filter(({ sectionId }) => sectionId === section.id);
  const byBlock = new Set(section.blocks?.flatMap((block) => (block.type === 'diagram_ref' ? [block.diagramId] : [])));
  const architecture = design.layoutStyle === DesignLayoutStyle.Arch;
  const modules = design.sections.filter(
    (candidate) => candidate.selected && candidate.kind === DesignSectionKind.Module && candidate.id !== section.id,
  );
  const graphLinks = graphs.length > 0 && (
    <section className={styles.proseBlock}>
      <h2>{C.relatedDiagrams}</h2>
      <ul className={styles.linkRows}>
        {graphs.map((graph) => (
          <li key={graph.id}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => onNavigate({ kind: 'diagram', sectionId: section.id, diagramId: graph.id })}
            >
              {graph.title}
            </button>
            <span className="hint">{DESIGN_DIAGRAM_LABEL[graph.kind]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  const fileLinks = files.length > 0 && (
    <section className={styles.proseBlock}>
      <h2>{C.relatedFiles}</h2>
      <ul className={styles.linkRows}>
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              className={`${styles.textButton} mono`}
              onClick={() => onNavigate(fileTarget(file, section.id))}
            >
              {file.relPath}
            </button>
            <span className="hint">{file.responsibility}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <>
      {section.summary !== '' && (
        <div className={styles.summary}>
          <Markdown source={section.summary} components={markdownComponents} />
        </div>
      )}
      {architecture && graphs.map(({ id }) => <div key={id}>{context.figure(id)}</div>)}
      {architecture && modules.length > 0 && (
        <section className={styles.proseBlock}>
          <h2>{C.modules}</h2>
          <ul className={styles.moduleGrid}>
            {modules.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onNavigate({ kind: 'section', sectionId: item.id })}>
                  <strong>{item.title}</strong>
                  <span>{item.summary || item.scopePaths.join(' · ') || C.waiting}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {architecture && fileLinks}
      {section.blocks?.map((block, index) =>
        architecture && block.type === 'diagram_ref' ? null : (
          // biome-ignore lint/suspicious/noArrayIndexKey: section content is replaced as a whole
          <ContentBlock key={index} block={block} context={context} />
        ),
      )}
      {!architecture && graphLinks}
      {!architecture && fileLinks}
      {!architecture &&
        graphs.filter(({ id }) => !byBlock.has(id)).map(({ id }) => <div key={id}>{context.figure(id)}</div>)}
      {section.reviewNotes !== null && section.reviewNotes.length > 0 && (
        <section className={styles.proseBlock}>
          <h2>{DESIGN_REVIEW_LABEL[section.reviewState]}</h2>
          <ul className={styles.evidence}>
            {section.reviewNotes.map((note, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: review notes are replaced as a whole
              <li key={index}>
                {note.message}
                {note.relPath !== undefined && context.source(note.relPath, note.lineStart)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
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
  const symbol = target.kind === 'file' ? file?.symbols.find(({ id }) => id === target.symbolId) : undefined;
  const title = file?.relPath ?? graph?.title ?? section.title;
  const canEdit = design.projectId !== null && !busy;
  const context: ContentContext = {
    source: (path, line) => {
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
                onNavigate(fileTarget(known, section.id, known.symbols.find(({ lineStart }) => lineStart === line)?.id))
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
        <span>{design.title}</span>
        <span aria-hidden="true">›</span>
        {file === undefined && graph === undefined ? (
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
            <span aria-hidden="true">›</span>
            <span aria-current="page">{title}</span>
          </>
        )}
      </nav>
      <header className={styles.readerHeading}>
        <div>
          <span className={styles.readerKind}>
            {file !== undefined ? C.file : graph !== undefined ? DESIGN_DIAGRAM_LABEL[graph.kind] : C.section}
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
        <FileDetails file={file} activeSymbol={symbol?.id} context={context} />
      ) : graph !== undefined ? (
        context.figure(graph.id)
      ) : (
        <SectionDetails design={design} section={section} context={context} onNavigate={onNavigate} />
      )}
    </article>
  );
}
