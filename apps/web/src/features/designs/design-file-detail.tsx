import type { DesignFileDTO, DesignSymbol } from '@aw/shared';
import { useEffect, useRef } from 'react';
import { Markdown } from '../../components/markdown.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { type ContentContext, markdownComponents, Syntax } from './design-content.tsx';
import styles from './design-workbench.module.css';

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
  const selected = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) selected.current?.scrollIntoView({ block: 'center' });
  }, [active]);
  return (
    <section className={styles.symbol} data-highlight={active || undefined} ref={selected}>
      <h3>{symbol.qualifiedName}</h3>
      <div className="row wrap hint">
        <span>{symbol.kind}</span>
        <span>{C.methodLines(symbol.lineStart, symbol.lineEnd)}</span>
        {context.source(file.relPath, symbol.lineStart)}
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
  file,
  activeSymbol,
  context,
}: {
  file: DesignFileDTO;
  activeSymbol: string | undefined;
  context: ContentContext;
}) {
  return (
    <>
      <div className="row wrap">{context.source(file.relPath)}</div>
      {file.responsibility === null ? (
        <p className="hint">{C.emptyFile}</p>
      ) : (
        <Markdown source={file.responsibility} components={markdownComponents} />
      )}
      {file.symbols.length > 0 && <h2>{C.relatedFiles}</h2>}
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
