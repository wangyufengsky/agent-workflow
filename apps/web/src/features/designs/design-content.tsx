import { type DesignBlock, DesignEvidenceClass } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef } from 'react';
import type { Components } from 'react-markdown';
import { highlight } from '../../components/diff/highlight.ts';
import { Markdown } from '../../components/markdown.tsx';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import styles from './design-workbench.module.css';

/** 将引用限制成项目相对路径，不从 Markdown 发起远程资源请求。 */
export const markdownComponents: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => (alt === undefined ? null : <span>{alt}</span>),
};

export function Syntax({
  path,
  source,
  start,
  selection,
  label,
}: {
  path: string;
  source: string;
  start?: number;
  selection?: { start: number; end: number } | undefined;
  label?: string | undefined;
}) {
  const frame = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (selection === undefined || frame.current === null) return;
    const pre = frame.current;
    const line = pre.querySelector('[data-current-line]');
    if (line === null) return;
    line.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selection]);
  const query = useQuery({
    queryKey: ['designHighlight', path, source],
    queryFn: () => highlight(path, source),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const lines = source.split('\n').map((text, index) => ({ text, index }));
  return (
    <pre className={styles.code} ref={frame} {...(label === undefined ? {} : { role: 'region', 'aria-label': label })}>
      <code>
        {lines.map((line) => (
          <span
            className={styles.codeLine}
            key={line.index}
            data-current-line={
              selection !== undefined &&
              start !== undefined &&
              start + line.index >= selection.start &&
              start + line.index <= selection.end
                ? true
                : undefined
            }
          >
            {start !== undefined && (
              <span className={styles.lineNumber} aria-hidden="true">
                {start + line.index}
              </span>
            )}
            {query.data?.[line.index]?.map((token, tokenIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are position-based within a line
              <span key={tokenIndex} style={{ color: token.color }}>
                {token.content}
              </span>
            )) ?? line.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

export type ContentContext = {
  source: (path: string, line?: number, end?: number) => ReactNode;
  figure: (id: string) => ReactNode;
};

export function ContentBlock({ block, context }: { block: DesignBlock; context: ContentContext }) {
  if (block.type === 'diagram_ref') return context.figure(block.diagramId);
  if (block.type === 'submodule') return null;
  return (
    <section className={styles.proseBlock} data-callout={block.type === 'callout' ? block.tone : undefined}>
      {block.title !== undefined && <h2>{block.title}</h2>}
      {block.type === 'transaction' && (
        <p>{[block.code, block.channel, block.version, block.scenario].filter(Boolean).join(' · ')}</p>
      )}
      {(block.type === 'markdown' || block.type === 'transaction') && (
        <>
          {block.type === 'markdown' && <Markdown source={block.markdown} components={markdownComponents} />}
          {block.evidence !== undefined && block.evidence.length > 0 && (
            <ul aria-label={C.evidence} className={styles.evidence}>
              {block.evidence.map((evidence, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: evidence order belongs to an immutable submission
                <li key={index}>
                  {evidence.evidenceClass === DesignEvidenceClass.Static ? (
                    <>
                      <span className={styles.sourceTag}>{C.static}</span>
                      {context.source(evidence.relPath, evidence.lineStart, evidence.lineEnd)}
                    </>
                  ) : (
                    <>
                      <span className={styles.sourceTag}>{C.inferred}</span>
                      {evidence.rationale}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {block.type === 'callout' && <Markdown source={block.body} components={markdownComponents} />}
      {block.type === 'code' && (
        <>
          <div className="hint">{context.source(block.relPath, block.lineStart, block.lineEnd)}</div>
          <Syntax path={block.relPath} source={block.code} start={block.lineStart} />
        </>
      )}
      {block.type === 'table' && (
        <div className={styles.tableScroll}>
          <table>
            {block.caption !== undefined && <caption>{block.caption}</caption>}
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: table columns may repeat
                  <th key={index} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional data
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional data
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
