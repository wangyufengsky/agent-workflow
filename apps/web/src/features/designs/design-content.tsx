import { type DesignBlock, DesignEvidenceClass } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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

export function Syntax({ path, source, start }: { path: string; source: string; start?: number }) {
  const query = useQuery({
    queryKey: ['designHighlight', path, source],
    queryFn: () => highlight(path, source),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const lines = source.split('\n');
  return (
    <pre className={styles.code}>
      <code>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: source lines are position-based
          <span className={styles.codeLine} key={index}>
            {start !== undefined && (
              <span className={styles.lineNumber} aria-hidden="true">
                {start + index}
              </span>
            )}
            {query.data?.[index]?.map((token, tokenIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are position-based within a line
              <span key={tokenIndex} style={{ color: token.color }}>
                {token.content}
              </span>
            )) ?? line}
          </span>
        ))}
      </code>
    </pre>
  );
}

export type ContentContext = {
  source: (path: string, line?: number) => ReactNode;
  figure: (id: string) => ReactNode;
};

export function ContentBlock({ block, context }: { block: DesignBlock; context: ContentContext }) {
  if (block.type === 'diagram_ref') return context.figure(block.diagramId);
  return (
    <section className={styles.proseBlock} data-callout={block.type === 'callout' ? block.tone : undefined}>
      {block.title !== undefined && <h2>{block.title}</h2>}
      {block.type === 'markdown' && (
        <>
          <Markdown source={block.markdown} components={markdownComponents} />
          {block.evidence !== undefined && block.evidence.length > 0 && (
            <ul aria-label={C.evidence} className={styles.evidence}>
              {block.evidence.map((evidence, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: evidence order belongs to an immutable submission
                <li key={index}>
                  {evidence.evidenceClass === DesignEvidenceClass.Static ? (
                    <>
                      <span className={styles.sourceTag}>{C.static}</span>
                      {context.source(evidence.relPath, evidence.lineStart)}
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
          <div className="hint">{context.source(block.relPath, block.lineStart)}</div>
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
