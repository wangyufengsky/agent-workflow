import {
  DesignDiagramKind,
  type DesignDTO,
  type DesignRunDTO,
  DesignSectionKind,
  TRANSACTION_EXPLORER_KEY,
} from '@aw/shared';
import { Markdown } from '../../components/markdown.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { DesignArchitecture } from './design-architecture.tsx';
import type { CompositionItem } from './design-composition.tsx';
import type { ContentContext } from './design-content.tsx';
import { markdownComponents } from './design-content.tsx';
import { fileTarget, type ReadingTarget } from './design-reading.ts';
import { TransactionCatalog } from './design-transactions.tsx';
import styles from './design-workbench.module.css';

export function DesignOverview({
  design,
  active,
  highlighted,
  onNavigate,
}: {
  design: DesignDTO;
  active: DesignRunDTO | undefined;
  highlighted: boolean;
  onNavigate: (target: ReadingTarget) => void;
}) {
  const sections = design.sections.filter(({ selected }) => selected);
  const overview = sections.find(({ kind }) => kind === DesignSectionKind.Overview);
  const introduction = overview?.summary ?? sections.find(({ blocks }) => blocks !== null)?.summary;
  const working = active?.targetSectionIds.find((id) => !active.doneSectionIds.includes(id));
  const candidates = sections.filter(({ id }) => id !== overview?.id);
  const modules = candidates.filter(({ kind }) => kind === DesignSectionKind.Module);
  const elements = modules.length > 0 ? modules : candidates;
  const structure = elements
    .filter(({ blocks }) => blocks !== null)
    .map(
      ({ id, title, summary }): CompositionItem => ({
        id,
        title,
        detail: summary || C.section,
        target: { kind: 'section', sectionId: id },
      }),
    );
  const dependencies = design.diagrams.filter(({ kind }) => kind === DesignDiagramKind.Architecture);
  const entries = sections.flatMap((section) =>
    (section.blocks ?? []).flatMap((block) =>
      block.type === 'transaction' ? [{ ...block, sectionId: section.id }] : [],
    ),
  );
  const transactionView = design.templateKey === TRANSACTION_EXPLORER_KEY || entries.length > 0;
  const source: ContentContext['source'] = (path, line, end) => {
    const file = design.files.find(({ relPath }) => relPath === path);
    const label = line === undefined ? path : `${path}:${line}`;
    if (file?.sectionId == null) return <code>{label}</code>;
    const target = fileTarget(
      file,
      file.sectionId,
      undefined,
      line === undefined ? undefined : { start: line, end: end ?? line },
    );
    return (
      <button type="button" className={styles.textButton} onClick={() => onNavigate(target)}>
        {label}
      </button>
    );
  };
  return (
    <article className={`${styles.article} ${styles.overview}`} data-highlight={highlighted || undefined}>
      <nav className={styles.breadcrumb} aria-label={C.breadcrumb}>
        <span aria-current="page">{C.overview}</span>
      </nav>
      <header className={styles.readerHeading}>
        <div>
          <span className={styles.readerKind}>{C.projectLevel}</span>
          <h2>{design.title}</h2>
        </div>
      </header>
      <div className={styles.summary}>
        {introduction ? (
          <Markdown source={introduction} components={markdownComponents} />
        ) : overview === undefined ? null : (
          <p>{C.overviewPending}</p>
        )}
      </div>
      {transactionView && (
        <TransactionCatalog entries={entries} design={design} source={source} onNavigate={onNavigate} />
      )}
      <section className={styles.exploreSection}>
        <h3>{C.projectOutline}</h3>
        <ul className={styles.exploreCards}>
          {sections.map(({ id, title, blocks, summary }) => (
            <li key={id}>
              <button type="button" onClick={() => onNavigate({ kind: 'section', sectionId: id })}>
                <span>{id === working ? C.working : blocks === null ? C.waiting : C.completed}</span>
                <strong>{title}</strong>
                {summary && <small>{summary}</small>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {!transactionView && (
        <DesignArchitecture
          title={C.projectArchitecture}
          design={design}
          dependencies={dependencies}
          parent={{ id: 'project', title: design.title, detail: C.projectLevel }}
          items={structure}
          onNavigate={onNavigate}
          source={source}
        />
      )}

      <footer className={styles.reportVersion}>
        {design.commitSha === null ? C.noSource : C.reportVersion(design.commitSha.slice(0, 8))}
      </footer>
    </article>
  );
}
