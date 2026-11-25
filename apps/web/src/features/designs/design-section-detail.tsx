import {
  type DesignBlock,
  type DesignDTO,
  type DesignFileDTO,
  DesignLayoutStyle,
  type DesignSectionDTO,
  DesignSectionKind,
} from '@aw/shared';
import { Markdown } from '../../components/markdown.tsx';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_DIAGRAM_LABEL, DESIGN_REVIEW_LABEL } from '../../copy/design-workbench.ts';
import { DesignArchitecture, dependenciesFor } from './design-architecture.tsx';
import type { CompositionItem } from './design-composition.tsx';
import { ContentBlock, type ContentContext, markdownComponents } from './design-content.tsx';
import {
  basename,
  type DesignSubmodule,
  fileSubmodule,
  fileTarget,
  type ReadingTarget,
  submodulesOf,
} from './design-reading.ts';
import styles from './design-workbench.module.css';

type ChapterProps = { design: DesignDTO; section: DesignSectionDTO; onNavigate: (target: ReadingTarget) => void };

function FunctionalExplanation({
  items,
  context,
}: {
  items: { title: string; markdown: string; evidence?: Extract<DesignBlock, { type: 'markdown' }>['evidence'] }[];
  context: ContentContext;
}) {
  return items.length === 0 ? null : (
    <section className={styles.exploreSection}>
      <h3>{C.functionalExplanation}</h3>
      {items.map(({ title, markdown, evidence }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: functions retain the order of on-file evidence
        <details className={styles.behavior} key={index} open={index === 0}>
          <summary>{title}</summary>
          <ContentBlock
            block={{ type: 'markdown', markdown, ...(evidence === undefined ? {} : { evidence }) }}
            context={context}
          />
        </details>
      ))}
    </section>
  );
}

export function SectionDetails({
  design,
  section,
  context,
  onNavigate,
}: ChapterProps & {
  context: ContentContext;
}) {
  const graphs = design.diagrams.filter(({ sectionId }) => sectionId === section.id);
  const submodules = submodulesOf(section);
  const files = design.files.filter(
    (file) =>
      file.sectionId === section.id && file.responsibility !== null && fileSubmodule(file, section) === undefined,
  );
  const composed = [
    ...submodules.map(
      ({ id, title, files }): CompositionItem => ({
        id: `module:${id}`,
        title,
        detail: C.fileChildCount(files.length),
        target: { kind: 'submodule', sectionId: section.id, submoduleId: id },
      }),
    ),
    ...files.map(
      (file): CompositionItem => ({
        id: file.id,
        title: basename(file.relPath),
        detail: file.relPath,
        target: fileTarget(file, section.id),
      }),
    ),
  ];
  const composition = (composed.length > 0 || graphs.length > 0) && (
    <DesignArchitecture
      title={C.internalArchitecture}
      design={design}
      parent={{ id: 'chapter', title: section.title, detail: C.section }}
      items={composed}
      dependencies={graphs}
      onNavigate={onNavigate}
      source={context.source}
    />
  );
  const moduleLinks = submodules.length > 0 && (
    <section className={styles.exploreSection}>
      <h3>{C.children}</h3>
      <ul className={styles.exploreCards}>
        {submodules.map(({ id, title, summary }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onNavigate({ kind: 'submodule', sectionId: section.id, submoduleId: id })}
            >
              <span>{C.submodule}</span>
              <strong>{title}</strong>
              <small>{summary}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
  const byBlock = new Set(section.blocks?.flatMap((block) => (block.type === 'diagram_ref' ? [block.diagramId] : [])));
  const architecture = design.layoutStyle === DesignLayoutStyle.Arch;
  const behaviors = (section.blocks ?? []).flatMap((block) =>
    section.kind === DesignSectionKind.Module &&
    block.type === 'markdown' &&
    block.title !== undefined &&
    (block.evidence?.length ?? 0) > 0
      ? [{ block, title: block.title, markdown: block.markdown, evidence: block.evidence }]
      : [],
  );
  const explained = new Set<DesignBlock>(behaviors.map(({ block }) => block));
  const modules =
    section.kind !== DesignSectionKind.Overview
      ? []
      : design.sections.filter(
          (candidate) =>
            candidate.selected && candidate.kind === DesignSectionKind.Module && candidate.id !== section.id,
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
              {basename(file.relPath)}
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
      {architecture && composition}
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
      {architecture && moduleLinks}
      {architecture && fileLinks}
      <FunctionalExplanation items={behaviors} context={context} />
      {section.blocks?.map((block, index) =>
        explained.has(block) || block.type === 'submodule' || (architecture && block.type === 'diagram_ref') ? null : (
          // biome-ignore lint/suspicious/noArrayIndexKey: section content is replaced as a whole
          <ContentBlock key={index} block={block} context={context} />
        ),
      )}
      {!architecture && composition}
      {!architecture && moduleLinks}
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

export function SubmoduleDetails({
  design,
  module,
  files,
  section,
  context,
  onNavigate,
}: {
  design: DesignDTO;
  module: DesignSubmodule;
  files: DesignFileDTO[];
  section: DesignSectionDTO;
  context: ContentContext;
  onNavigate: ChapterProps['onNavigate'];
}) {
  return (
    <>
      {module.summary && (
        <div className={styles.summary}>
          <Markdown source={module.summary} components={markdownComponents} />
        </div>
      )}
      <DesignArchitecture
        title={C.internalArchitecture}
        design={design}
        parent={{ id: 'submodule', title: module.title, detail: C.submodule }}
        items={files.map((file) => ({
          id: file.id,
          title: basename(file.relPath),
          detail: file.relPath,
          target: fileTarget(file, section.id),
        }))}
        dependencies={dependenciesFor(
          design,
          (target) =>
            (target.kind === 'submodule' && target.sectionId === section.id && target.submoduleId === module.id) ||
            (target.kind === 'file' && files.some(({ id }) => id === target.fileId)),
        )}
        onNavigate={onNavigate}
        source={context.source}
      />

      <FunctionalExplanation items={module.behaviors} context={context} />
      {files.length > 0 && (
        <section className={styles.exploreSection}>
          <h3>{C.children}</h3>
          <ul className={styles.exploreCards}>
            {files.map((file) => (
              <li key={file.id}>
                <button type="button" title={file.relPath} onClick={() => onNavigate(fileTarget(file, section.id))}>
                  <span>{C.file}</span>
                  <strong>{basename(file.relPath)}</strong>
                  <small>{file.responsibility}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
