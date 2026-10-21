import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './markdown.module.css';

/**
 * Model-written Markdown (summaries, reports, answers). Raw HTML is not rendered, so the text cannot inject markup;
 * `components` replaces how elements render (the knowledge answer's citation marks, 18 §2.1).
 */
export function Markdown({ source, components }: { source: string; components?: Components }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} {...(components === undefined ? {} : { components })}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
