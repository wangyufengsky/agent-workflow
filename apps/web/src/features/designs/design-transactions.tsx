import './site-assets/transaction-reader.css';
import {
  type DesignDiagramNode,
  type DesignDTO,
  type DesignTransaction,
  presentTransactionDiagram,
  TRANSACTION_EXPLORER_KEY,
} from '@aw/shared';
import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '../../components/icon.tsx';
import siteCopy from '../../copy/design-site.json';
import type { ContentContext } from './design-content.tsx';
import { DiagramBoard, EdgeList, type GraphProps } from './design-diagram.tsx';
import { basename, fileTarget, graphNodeTarget, type ReadingTarget } from './design-reading.ts';
import { type TransactionLocation, TransactionSourceDialog, TransactionTraces } from './design-transaction-traces.tsx';
import styles from './design-workbench.module.css';

const C = siteCopy.transactions;
type View = 'flow' | 'fields' | 'boundaries' | 'sources';
const views: readonly [View, IconName][] = [
  ['flow', 'flow'],
  ['fields', 'table'],
  ['boundaries', 'layers'],
  ['sources', 'file'],
];

export function TransactionFigure({
  design,
  transaction,
  presentation,
  diagram,
  onNavigate,
}: Pick<GraphProps, 'diagram' | 'onNavigate'> & {
  design: DesignDTO;
  transaction: DesignTransaction;
  presentation?: ReturnType<typeof presentTransactionDiagram>;
}) {
  const projection = useMemo(
    () => presentation ?? presentTransactionDiagram(diagram.nodes, diagram.edges, design.files, transaction),
    [presentation, diagram.nodes, diagram.edges, design.files, transaction],
  );
  const titles = useMemo(() => new Map(projection.nodes.map((node) => [node.id, node.title])), [projection]);
  const [view, setView] = useState<View>('flow');
  const [selected, select] = useState(diagram.nodes[0]?.id);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [location, setLocation] = useState<TransactionLocation | null>(null);
  const step = diagram.nodes.find((node) => node.id === selected);
  const label = projection.nodes.find((node) => node.id === selected);
  function targetOf(node: DesignDiagramNode) {
    if (node.targetKind === 'section' || node.targetKind === 'module')
      return graphNodeTarget(design, diagram.sectionId, node);
    const source = projection.nodes.find((record) => record.id === node.id)?.source;
    if (!source) return undefined;
    const file = design.files.find((file) => file.id === source.fileId);
    return file && fileTarget(file, diagram.sectionId, source.symbolId);
  }
  const target = step && targetOf(step);
  const linkedFile = target?.kind === 'file' ? design.files.find((file) => file.id === target.fileId) : undefined;
  const symbol =
    target?.kind === 'file' ? linkedFile?.symbols.find((symbol) => symbol.id === target.symbolId) : undefined;
  const path = linkedFile?.relPath ?? step?.relPath;
  const fields = transaction.fields ?? [];
  const related = fields.flatMap((field, index) =>
    selected && field.steps.includes(selected) ? [{ field, index }] : [],
  );
  const outgoing = diagram.edges.filter((edge) => edge.from === selected);

  function chooseStep(id: string) {
    select(id);
    setView('flow');
  }
  const openSource: ContentContext['source'] = (path, start, end) => (
    <button
      type="button"
      className="tx-source-link"
      onClick={() => setLocation({ path, ...(start === undefined ? {} : { range: { start, end: end ?? start } }) })}
    >
      {start === undefined ? path : `${path}:${start}`}
    </button>
  );
  const actions = { diagram, targetOf, onNavigate, source: openSource };

  return (
    <div className="tx-reader">
      <nav className="tx-tabs" aria-label={C.graph}>
        {views.map(([id, icon]) => (
          <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
            <Icon name={icon} />
            {C[id]}
          </button>
        ))}
      </nav>
      <div hidden={view !== 'flow'} aria-hidden={view !== 'flow'} inert={view !== 'flow'}>
        <div className="tx-board">
          <div className="tx-graph">
            <ReactFlowProvider>
              <DiagramBoard
                {...actions}
                transaction={{ profile: transaction, files: design.files, projection, selected, select }}
              />
            </ReactFlowProvider>
            <div className="tx-legend">
              <span data-kind="normal">{C.relations}</span>
              {projection.edges.some((edge) => edge.role === 'exception') && (
                <span data-kind="exception">{C.exceptions}</span>
              )}
              {diagram.edges.some((edge) => edge.evidenceClass === 'inferred') && (
                <span data-kind="inferred">{C.inferred}</span>
              )}
              {projection.nodes.some((node) => node.role === 'external') && (
                <span data-kind="external">{C.external}</span>
              )}
            </div>
          </div>
          {step && label && (
            <aside className="tx-inspector" aria-label={C.steps}>
              <div className="tx-kicker">
                <Icon name="target" size="sm" />
                {C.nodeDetails}
              </div>
              <h3>{label.title}</h3>
              {label.detail && <code className="tx-method">{label.detail}</code>}
              {step.group && <small>{step.group}</small>}
              {step.summary && step.summary.trim() !== label.title && <p>{step.summary}</p>}
              {(path || target) && (
                <section className="tx-detail">
                  <h4>{C.sourceLocation}</h4>
                  {path && openSource(path, symbol?.lineStart, symbol?.lineEnd)}
                  {target && (
                    <button className="tx-deep-link" type="button" onClick={() => onNavigate(target)}>
                      {C.source}
                      <Icon name="chevron" size="sm" />
                    </button>
                  )}
                </section>
              )}
              {related.length > 0 && (
                <section className="tx-detail">
                  <h4>{C.relatedFields}</h4>
                  <div className="tx-links">
                    {related.map(({ field, index }) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setFieldIndex(index);
                          setView('fields');
                        }}
                      >
                        {field.name}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {outgoing.length > 0 && (
                <section className="tx-detail">
                  <h4>{C.outgoing}</h4>
                  {outgoing.map((edge) => (
                    <button className="tx-next" type="button" key={edge.id} onClick={() => chooseStep(edge.to)}>
                      <strong>{titles.get(edge.to)}</strong>
                      <small>{edge.label ?? edge.kind}</small>
                      <Icon name="chevron" size="sm" />
                    </button>
                  ))}
                </section>
              )}
            </aside>
          )}
        </div>
        <EdgeList {...actions} />
      </div>
      {(view === 'fields' || view === 'boundaries') && (
        <TransactionTraces
          key={view}
          traces={transaction[view] ?? []}
          initial={view === 'fields' ? fieldIndex : 0}
          empty={view === 'fields' ? C.noFields : C.noBoundaries}
          titles={titles}
          choose={chooseStep}
          source={openSource}
        />
      )}
      {view === 'sources' && (
        <div className="tx-sources">
          {projection.sourcePaths.length === 0 && <p className="tx-empty">{C.noSources}</p>}
          {projection.sourcePaths.map((path) => (
            <div key={path}>
              {openSource(path)}
              <p>{design.files.find((file) => file.relPath === path)?.responsibility}</p>
            </div>
          ))}
        </div>
      )}
      {location && (
        <TransactionSourceDialog
          design={design}
          location={location}
          sectionId={diagram.sectionId}
          onNavigate={onNavigate}
          close={() => setLocation(null)}
        />
      )}
    </div>
  );
}

export function useTransactionCatalog(design: DesignDTO) {
  const entries = useMemo(
    () =>
      design.sections
        .filter(({ selected }) => selected)
        .flatMap((section) =>
          (section.blocks ?? []).flatMap((block) =>
            block.type === 'transaction' ? [{ ...block, sectionId: section.id }] : [],
          ),
        ),
    [design.sections],
  );
  const [query, setQuery] = useState('');
  const [selected, select] = useState('');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const visible = entries.filter(({ title, code, channel, version, scenario }) => {
    const description = [title, code, channel, version, scenario].join(' ').toLocaleLowerCase();
    return terms.every((term) => description.includes(term));
  });
  const active = visible.find(({ diagramId }) => diagramId === selected) ?? visible[0];
  const diagram = design.diagrams.find(({ id }) => id === active?.diagramId);
  const projection = useMemo(
    () =>
      active && diagram ? presentTransactionDiagram(diagram.nodes, diagram.edges, design.files, active) : undefined,
    [active, diagram, design.files],
  );
  return {
    enabled: design.templateKey === TRANSACTION_EXPLORER_KEY || entries.length > 0,
    hasEntries: entries.length > 0,
    query,
    setQuery,
    visible,
    active,
    select,
    diagram,
    projection,
  };
}
type Catalog = ReturnType<typeof useTransactionCatalog>;

export function TransactionCatalog({
  catalog,
  design,
  onNavigate,
}: {
  catalog: Catalog;
  design: DesignDTO;
  onNavigate: (target: ReadingTarget) => void;
}) {
  const { hasEntries, query, setQuery, visible, active, select, projection } = catalog;
  const [location, setLocation] = useState<TransactionLocation | null>(null);
  return (
    <section className="tx-reader" aria-label={C.catalog}>
      <div className="tx-catalog">
        {hasEntries && (
          <input
            type="search"
            className="tx-filter"
            aria-label={C.filter}
            placeholder={C.filter}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              onNavigate({ kind: 'overview' });
            }}
          />
        )}
        {visible.length === 0 ? (
          <p className="tx-empty" role="status">
            {hasEntries ? C.noMatch : C.empty}
          </p>
        ) : (
          <ul className="tx-list">
            {visible.map((entry) => (
              <li key={entry.diagramId}>
                <button
                  type="button"
                  aria-pressed={entry === active}
                  onClick={() => {
                    select(entry.diagramId);
                    onNavigate({ kind: 'overview' });
                  }}
                >
                  <strong>{entry.title}</strong>
                  {entry.code && <code>{entry.code}</code>}
                  <small>{[entry.channel, entry.version].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {projection && projection.sourcePaths.length > 0 && (
        <div className="tx-files">
          <h3>{C.referencedFiles}</h3>
          {projection.sourcePaths.map((path) => (
            <button type="button" key={path} title={path} aria-label={path} onClick={() => setLocation({ path })}>
              <Icon name="file" size="sm" />
              {basename(path)}
            </button>
          ))}
        </div>
      )}
      {active && location && (
        <TransactionSourceDialog
          design={design}
          location={location}
          sectionId={active.sectionId}
          onNavigate={onNavigate}
          close={() => setLocation(null)}
        />
      )}
    </section>
  );
}

export function TransactionReport({
  catalog,
  design,
  onNavigate,
}: {
  catalog: Catalog;
  design: DesignDTO;
  onNavigate: (target: ReadingTarget) => void;
}) {
  const { active, diagram, projection } = catalog;
  return (
    <section className={`tx-reader ${styles.article}`} aria-label={C.flow}>
      {active && diagram && projection ? (
        <>
          <header className="tx-heading">
            <div>
              <h2>{active.title}</h2>
              <small>{[active.code, active.channel, active.version].filter(Boolean).join(' · ')}</small>
              {active.scenario && <p>{active.scenario}</p>}
            </div>
            <button
              type="button"
              className="tx-deep-link"
              onClick={() => onNavigate({ kind: 'section', sectionId: active.sectionId })}
            >
              {C.chapter}
              <Icon name="chevron" size="sm" />
            </button>
          </header>
          <TransactionFigure
            key={diagram.id}
            design={design}
            presentation={projection}
            transaction={active}
            diagram={diagram}
            onNavigate={onNavigate}
          />
        </>
      ) : (
        <p className="tx-empty">{catalog.hasEntries ? C.noMatch : C.empty}</p>
      )}
    </section>
  );
}
