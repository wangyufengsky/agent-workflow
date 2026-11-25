import type { DesignDTO, DesignFileDTO, DesignSymbol } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { DesignArchitecture, dependenciesFor } from './design-architecture.tsx';
import { type ContentContext, markdownComponents, Syntax } from './design-content.tsx';
import { basename, fileTarget, type ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';
import { designSourceQuery } from './designs.queries.ts';

function SymbolDetails({
  file,
  symbol,
  active,
  context,
}: {
  file: DesignFileDTO;
  symbol: DesignSymbol;
  active: boolean;
  context: ContentContext;
}) {
  return (
    <section className={styles.symbol} data-highlight={active || undefined}>
      <h3>{symbol.qualifiedName}</h3>
      <div className="row wrap hint">
        <span>{symbol.kind}</span>
        <span>{C.methodLines(symbol.lineStart, symbol.lineEnd)}</span>
        {context.source(file.relPath, symbol.lineStart, symbol.lineEnd)}
      </div>
      {symbol.signature !== undefined && <Syntax path={file.relPath} source={symbol.signature} />}
      <Markdown source={symbol.summary} components={markdownComponents} />
      {(
        [
          [C.throws, symbol.throws],
          [C.callers, symbol.callers],
          [C.callees, symbol.callees],
        ] as const
      ).map(
        ([label, items]) =>
          items !== undefined &&
          items.length > 0 && (
            <div key={label} className={styles.symbolFacts}>
              <b>{label}</b>
              <span>{items.join(' · ')}</span>
            </div>
          ),
      )}
    </section>
  );
}

export function FileDetails({
  design,
  file,
  activeSymbol,
  lineRange,
  context,
  onNavigate,
  sectionId,
}: {
  design: DesignDTO;
  file: DesignFileDTO;
  sectionId: string;
  activeSymbol: string | undefined;
  lineRange: { start: number; end: number } | undefined;
  context: ContentContext;
  onNavigate: (target: ReadingTarget) => void;
}) {
  const source = useQuery(designSourceQuery(design.id, file.id));
  const active = file.symbols.find(({ id }) => id === activeSymbol);
  const selection = lineRange ?? (active === undefined ? undefined : { start: active.lineStart, end: active.lineEnd });
  const goToSymbol = (id: string) => onNavigate(fileTarget(file, sectionId, id));
  return (
    <>
      <div className="row wrap">{context.source(file.relPath)}</div>
      {file.responsibility === null ? (
        <p className="hint">{C.emptyFile}</p>
      ) : (
        <div className={styles.summary}>
          <Markdown source={file.responsibility} components={markdownComponents} />
        </div>
      )}
      <DesignArchitecture
        title={C.fileArchitecture}
        design={design}
        parent={{ id: file.id, title: basename(file.relPath), detail: C.file }}
        items={file.symbols.map((symbol) => ({
          id: `symbol:${symbol.id}`,
          title: symbol.name,
          detail: symbol.kind,
          target: fileTarget(file, sectionId, symbol.id),
        }))}
        dependencies={dependenciesFor(design, (target) => target.kind === 'file' && target.fileId === file.id)}
        onNavigate={onNavigate}
        source={context.source}
      />

      <section className={styles.exploreSection}>
        <h3>{C.implementation}</h3>
        {file.symbols.length > 0 && (
          <fieldset className={styles.symbolChoices} aria-label={C.symbol}>
            {file.symbols.map(({ id, name, kind }) => (
              <button type="button" key={id} aria-pressed={id === activeSymbol} onClick={() => goToSymbol(id)}>
                {name} <small>· {kind}</small>
              </button>
            ))}
          </fieldset>
        )}
        {source.isPending && (
          <p className="hint" role="status">
            {C.sourceLoading}
          </p>
        )}
        {source.isError && <ErrorState error={source.error} onRetry={() => void source.refetch()} />}
        {source.data?.status === 'changed' && (
          <p className="hint" role="status">
            {C.sourceChanged}
          </p>
        )}
        {source.data?.status === 'unavailable' && (
          <p className="hint" role="status">
            {C.sourceUnavailable}
          </p>
        )}
        {source.data?.status === 'available' && (
          <div className={styles.sourcePanel}>
            <header>
              <b>{basename(file.relPath)}</b>
              {active && (
                <span>
                  {active.name} · L{active.lineStart}–{active.lineEnd}
                </span>
              )}
              <span className="grow" />
              <span>{C.sourceLineCount(source.data.content.split('\n').length)}</span>
            </header>
            <Syntax
              path={file.relPath}
              source={source.data.content}
              start={1}
              selection={selection}
              label={C.sourceContent}
            />
          </div>
        )}
      </section>
      {file.symbols.map((symbol) => (
        <SymbolDetails
          key={symbol.id}
          file={file}
          symbol={symbol}
          active={symbol.id === activeSymbol}
          context={context}
        />
      ))}
    </>
  );
}
